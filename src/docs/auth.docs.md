# Authentication & Token Documentation

## Purpose

Kanona uses a **dual-token JWT** model for dashboard authentication (admin and doctor accounts).

- **Access token** — short-lived; sent on every protected API request.
- **Refresh token** — long-lived; used only to obtain new token pairs without re-entering credentials.

Both tokens are signed JWTs **and** tracked in **Redis**. A token is valid only when its signature verifies **and** its session key exists in Redis. This allows immediate revocation (logout) without waiting for JWT expiry.

Patient mobile authentication uses a server-owned phone/OTP/PIN flow. Registration requires only verified phone ownership and a six-digit PIN; profile completion happens later.

## Patient Mobile Authentication

1. `POST /api/mobile/auth/start` with `{ phone }` returns `{ flowId, nextStep: "PIN" | "OTP" }`.
2. New phones verify the delivered OTP with `POST /api/mobile/auth/otp/verify`.
3. After verification, `POST /api/mobile/auth/pin/create` creates the User/Patient and returns access and refresh tokens immediately.
4. Existing patients use `POST /api/mobile/auth/pin/login` with exactly six numeric digits.
5. An administrator reset produces a one-time temporary PIN, revokes all sessions, and sets `mustChangePin`. The resulting restricted login can access only logout and `POST /api/mobile/auth/pin/change-required`.

OTP and support-OTP hashes live only in short-lived `AuthFlow` documents. `AuthEvent` retains non-secret journey events for authorized Dashboard monitoring. No endpoint lists OTP/PIN/hash/token values.

Production OTP delivery requires `OTP_DELIVERY_WEBHOOK_URL`. Development permits a no-op provider so automated tests can inject a delivery implementation; it must not be treated as real delivery.

For temporary frontend development, setting `OTP_DEBUG_RETURN_CODE=true` outside production adds an optional `debugOtp` field only to the immediate OTP generation response:

```json
{
  "flowId": "...",
  "nextStep": "OTP",
  "expiresAt": "2026-09-02T12:00:00.000Z",
  "debugOtp": "483921"
}
```

The resend response uses the same fields and contains the newly generated code. With the flag disabled, `debugOtp` is omitted. Existing-account `nextStep: "PIN"` responses never include it. Production startup rejects `OTP_DEBUG_RETURN_CODE=true`, and the runtime condition independently suppresses the field whenever `NODE_ENV=production`.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ACCESS_TOKEN_SECRET` | Yes | Secret used to sign and verify access JWTs (`jsonwebtoken`). |
| `REFRESH_TOKEN_SECRET` | Yes | Secret used to sign and verify refresh JWTs. Must be different from `ACCESS_TOKEN_SECRET`. |
| `OTP_DEBUG_RETURN_CODE` | No | Development/test only. Exact value `true` returns `debugOtp` outside production; defaults to disabled. Forbidden with `NODE_ENV=production`. |
| `REDIS_HOST` | Yes | Redis host for session storage. |
| `REDIS_PORT` | Yes | Redis port (default `6379`). |
| `REDIS_PASSWORD` | No | Redis password when auth is enabled. |

Example `.env`:

```env
ACCESS_TOKEN_SECRET=your-access-secret-min-32-chars
REFRESH_TOKEN_SECRET=your-refresh-secret-min-32-chars

REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
```

Use long, random secrets in production. Rotating a secret immediately invalidates all tokens signed with the old value.

---

## Token Types

### Access Token

| Property | Value |
|---|---|
| Signed with | `ACCESS_TOKEN_SECRET` |
| JWT expiry | `15m` |
| Redis lifetime | Bound to the logical session (up to 7 days) |
| Redis key | `auth:session:{sid}` |
| Sent via | `Authorization: Bearer <accessToken>` |
| Payload | `{ _id, role, sid, jti, sub, aud, tokenType: "access", restricted }` |

Used for protected routes. The JWT expires after 15 minutes, and every request also requires the corresponding logical Redis session to exist.

### Refresh Token

| Property | Value |
|---|---|
| Signed with | `REFRESH_TOKEN_SECRET` |
| JWT expiry | `7d` |
| Redis lifetime | 7 days |
| Redis state | Separate current-refresh digest key plus the matching digest in the logical session |
| Sent via | Request body on `POST /refresh` only — never as a Bearer header |
| Payload | `{ _id, role, sid, jti, sub, aud, tokenType: "refresh", restricted }` |

Used exclusively to rotate tokens. Lua atomically consumes the current `jti`, records a one-way consumed marker, and installs the replacement. Reuse revokes only that logical session family.

---

## JWT Payloads

Defined in `src/constants/jwt.ts`:

```ts
// Access token
interface AccessTokenPayload {
    _id: string;
    role: 'admin' | 'doctor' | 'nurse' | 'pharmacy' | 'patient';
    sid: string;
    jti: string;
    sub: string;
    aud: 'mobile' | 'dashboard';
    tokenType: 'access';
    restricted: boolean;
}

// Refresh token
interface RefreshTokenPayload {
    _id: string;
    role: 'admin' | 'doctor' | 'nurse' | 'pharmacy' | 'patient';
    sid: string;
    jti: string;
    sub: string;
    aud: 'mobile' | 'dashboard';
    tokenType: 'refresh';
    restricted: boolean;
}
```

Patient sessions use the `mobile` audience. Admin, Doctor, Nurse, and Pharmacy sessions use `dashboard`. Refresh re-reads the User and role profile, then verifies active status, role, audience, and restricted state.

---

## Session Storage (Redis)

Raw tokens are **never** stored in Redis. Each login/device has one logical session:

```text
auth:session:{sid} → JSON session state (TTL: 7 days)
auth:user:{user_id}:sessions → sorted set of active sids
auth:user:{user_id}:sequence → monotonic login ordering counter
auth:refresh:current:{sha256(jti)} → sid
auth:refresh:used:{sha256(jti)} → sid (until the session's absolute expiry)
```

Session state contains user, role, audience, restricted status, the current refresh-JTI hash, timestamps, and optional device metadata. Consumed markers contain neither a token nor a plaintext JTI.

Validation flow for protected routes (`AuthPlugin`):

```text
1. Read Authorization header
2. Verify access signature, expiry, subject, audience, session ID, and token type
3. Look up auth:session:{sid} in Redis
4. Compare user, role, audience, and restricted claim; if missing/mismatched → 401
5. Enforce the session's restricted state
6. Attach { phrase: { _id, role, sid, audience, mustChangePin } } to request context
```

---

## Auth Flow

### Login

```text
Client                          API                           Redis / MongoDB
  │                              │                                  │
  │  POST /api/dash/auth/login   │                                  │
  │  { phone, password }         │                                  │
  │ ────────────────────────────►│  Argon2id verification           │
  │                              │  find user (admin|doctor)        │
  │                              │ ────────────────────────────────►│
  │                              │  sign access + refresh JWTs      │
  │                              │  store both sessions in Redis    │
  │                              │ ────────────────────────────────►│
  │  { accessToken, refreshToken, user }                             │
  │ ◄────────────────────────────│                                  │
```

- Login is restricted to **`admin`** and **`doctor`** roles.
- User `status` must be **`active`**.
- Dashboard passwords and Patient PINs are stored only as **Argon2id** hashes through `Bun.password` (see `src/constants/hashing.ts`). Startup removes the retired recoverable credential field without reading its contents.

### Refresh (token rotation)

```text
Client                          API                           Redis
  │                              │                                  │
  │  POST /api/dash/auth/refresh │                                  │
  │  { refreshToken }            │                                  │
  │ ────────────────────────────►│  verify JWT (REFRESH_TOKEN_SECRET)
  │                              │  check refresh session in Redis  │
  │                              │  load user, confirm active     │
  │                              │  DELETE old refresh session    │
  │                              │  issue NEW access + refresh    │
  │                              │  store both new sessions       │
  │  { accessToken, refreshToken }                                   │
  │ ◄────────────────────────────│                                  │
```

Always replace stored tokens with the new values returned by `/refresh`. The previous refresh token becomes invalid immediately.

### Logout

```text
Client                          API                           Redis
  │                              │                                  │
  │  POST /api/dash/auth/logout  │                                  │
  │  Authorization: Bearer …     │                                  │
  │ ────────────────────────────►│  revoke access session only    │
  │  { message: 'تم تسجيل الخروج بنجاح' }                          │
  │ ◄────────────────────────────│                                  │
```

Logout revokes the **current access token** only. The refresh token remains valid until it expires or is used once and rotated. Clients that need full sign-out should discard the refresh token locally after logout.

---

## API Endpoints

Base URL: `http://localhost:3001/api`

### `POST /dash/auth/login`

Authenticate an admin or doctor.

**Auth required:** No

**Request body:**

```json
{
  "phone": "07700000000",
  "password": "123456"
}
```

**Success `200`:**

```json
{
  "error": false,
  "message": "تم تسجيل الدخول بنجاح",
  "data": {
    "accessToken": "<jwt>",
    "refreshToken": "<jwt>",
    "user": {
      "_id": "665000000000000000000001",
      "full_name": "Admin User",
      "phone": "07700000000",
      "role": "admin",
      "status": "active"
    }
  }
}
```

**Errors:**

| Status | Message | Cause |
|---|---|---|
| `401` | `رقم الهاتف أو كلمة المرور غير صحيحة` | Wrong phone/password or role not admin/doctor |
| `401` | `الحساب غير مفعّل` | User status is not `active` |

---

### `POST /dash/auth/refresh`

Issue a new access + refresh token pair.

**Auth required:** No (uses refresh token in body)

**Request body:**

```json
{
  "refreshToken": "<jwt>"
}
```

**Success `200`:**

```json
{
  "error": false,
  "data": {
    "accessToken": "<new-jwt>",
    "refreshToken": "<new-jwt>"
  }
}
```

**Errors:**

| Status | Message | Cause |
|---|---|---|
| `401` | `رمز التحديث غير صالح` | Invalid signature, expired JWT, or malformed token |
| `401` | `تم إلغاء رمز التحديث` | Refresh session not found in Redis (already rotated or revoked) |
| `401` | `الحساب غير موجود أو غير مفعّل` | User deleted, inactive, or suspended |

---

### `POST /dash/auth/logout`

Revoke the current access session.

**Auth required:** Yes — `Authorization: Bearer <accessToken>`

**Request body:** none

**Success `200`:**

```json
{
  "error": false,
  "message": "تم تسجيل الخروج بنجاح"
}
```

**Errors:**

| Status | Message | Cause |
|---|---|---|
| `401` | `Authorization is required` | Missing header |
| `401` | `Invalid token` | Bad signature or expired access JWT |
| `401` | `Session revoked` | Access session not in Redis |

---

## Using Tokens on Protected Routes

All dashboard admin and doctor routes require the access token:

```http
GET /api/dash/admin/clinics?page=1&limit=10
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json
```

The middleware accepts either:

- `Authorization: Bearer <token>`
- `Authorization: <token>` (raw token without `Bearer` prefix)

On success, controllers receive `phrase`:

```ts
{ _id: string; role: 'admin' | 'doctor' | 'patient' }
```

---

## Client Integration Guide

Recommended flow for dashboard / SPA / mobile admin apps:

1. **Login** — store `accessToken` and `refreshToken` securely (httpOnly cookie or secure storage).
2. **API calls** — attach `Authorization: Bearer ${accessToken}` to every protected request.
3. **On `401`** with `Invalid token` or `Session revoked`:
   - Call `POST /api/dash/auth/refresh` with the stored refresh token.
   - On success, save the new token pair and retry the original request.
   - On refresh failure, redirect to login.
4. **Proactive refresh** — optionally refresh shortly before the 15-minute access TTL to avoid failed requests.
5. **Logout** — call `/logout`, then delete both tokens from client storage.

Example refresh retry (pseudo-code):

```ts
async function apiFetch(url: string, options: RequestInit) {
  let res = await fetch(url, withAuth(options, accessToken));

  if (res.status === 401) {
    const refreshed = await fetch('/api/dash/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!refreshed.ok) throw new Error('Session expired');

    const { data } = await refreshed.json();
    accessToken = data.accessToken;
    refreshToken = data.refreshToken;
    saveTokens(accessToken, refreshToken);

    res = await fetch(url, withAuth(options, accessToken));
  }

  return res;
}
```

---

## Source Files

| File | Responsibility |
|---|---|
| `src/constants/jwt.ts` | Sign / verify access and refresh JWTs |
| `src/constants/hashing.ts` | Argon2id password hashing and verification |
| `src/middleware/auth.middleware.ts` | `AuthPlugin`, access session store/revoke/check |
| `src/controller/dash/auth.controller.ts` | Login, refresh, logout routes |
| `src/services/user.service.ts` | `findByCredentials` for login |

---

## Security Notes

- **Separate secrets** — never reuse `ACCESS_TOKEN_SECRET` as `REFRESH_TOKEN_SECRET`.
- **Refresh token rotation** — each refresh invalidates the previous refresh token; reuse of an old refresh token fails with `تم إلغاء رمز التحديث`.
- **Redis dependency** — if Redis is down, session checks fail and protected routes return `401`.
- **No token in URL** — pass tokens only in headers (access) or JSON body (refresh).
- **HTTPS in production** — required to protect tokens in transit.
- **Rate limiting** — global limit of 100 requests/minute applies to auth endpoints too (`elysia-rate-limit`).

---

## Postman

The collection at `src/docs/kanona.postman_collection.json` includes Auth requests. Set `baseUrl` to `http://localhost:3001/api`, run **Login** first (auto-saves `accessToken` and `refreshToken`), then call protected routes.

Note: older examples may use port `3000` without the `/api` prefix — the running server uses **`http://localhost:3001/api`**.
