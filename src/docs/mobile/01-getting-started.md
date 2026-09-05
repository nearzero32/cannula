# Getting Started

## Fast local setup

```bash
git clone https://github.com/nearzero32/cannula.git
cd cannula
git pull
cp .env.example .env
bun install
docker compose up --build
```

The Compose stack starts the API, Redis, and a single-node MongoDB replica set. For an already-running MongoDB replica set and Redis, use `bun run dev` (watch) or `bun run start`. Required environment values are documented in `.env.example`; never put production secrets in a Mobile build.

Seed the current fixtures with `bun run seed:mobile`. Useful safe variants are:

```bash
bun run seed:mobile --dry-run
bun run seed:mobile --reset
bun run seed:mobile --images=none
bun run seed:mobile --json
```

Local seeding uses `SEED_MONGODB_URI`, falling back to `MONGODB_URI`. Remote targets require both `--target=remote` and `--allow-remote`. Production-like targets additionally require `--allow-production-seed --confirm=CANNULA_DEMO_DATA`. `--reset` deletes only deterministic seed IDs and their known dependent records before recreating them.

Swagger UI is `/api/swagger` and JSON is `/api/swagger/json` only when Swagger is enabled. It defaults on outside production unless overridden; when explicitly enabled, `SWAGGER_USERNAME` and a random password of at least 32 characters are required. See the known global-security mismatch in `KNOWN_BACKEND_INTEGRATION_ISSUES.md`.

Recommended first calls:

1. `POST /mobile/auth/start`
2. `POST /mobile/auth/pin/login` for the demo account
3. In parallel: `GET /mobile/ads`, `/specialties`, `/doctors/available`, `/home-care/categories`
4. `GET /mobile/profile`
5. `GET /mobile/notifications`

## Headers and envelopes

Send `Content-Type: application/json` for JSON bodies. Protected calls require `Authorization: Bearer <accessToken>`. Guest notification calls require `X-Installation-Id: 550e8400-e29b-41d4-a716-446655440000`.

Most success responses are `{ "error": false, "message": "...", "data": ... }`. Logout returns no `data`; unread-count returns `{ "error": false, "data": { "unread_count": 3 } }`. Domain failures are normally `{ "error": true, "message": "...", "code": "..." }`; Elysia validation failures instead use `{ "type": "validation", "on": "body", "message": "..." }`.

Page pagination is:

```json
{ "page": 1, "limit": 20, "total": 42, "pages": 3, "hasNext": true, "hasPrev": false }
```

Notifications also use page pagination (not cursors) and add top-level `unread_count`. Load `page + 1` only when `hasNext` is true and de-duplicate by `_id`.

## Home composition and client caching

There is no combined Home endpoint. Fetch Ads, Specialties, Available Doctors, and Home Care categories independently and render partial successes. Client recommendations: cache Specialties and Home Care catalog longer; refresh Ads periodically; refresh Available Doctors frequently and after bookings; refresh Notifications on foreground and pull-to-refresh. Server TTLs are currently Ads 60 seconds, Specialties 300 seconds, Available Doctors 30 seconds, and Home Care catalog 300 seconds; writes invalidate relevant catalogs where implemented.

## Offline and retry guidance

Client recommendation: retry safe GETs with bounded backoff. Do not blindly replay POST/PATCH/DELETE. Booking and request creation have no client idempotency key contract; after uncertain network failure, list/refresh first and retry only if the record was not created. After mutations, replace the entity with the returned DTO, then refresh its list/count.

## Date and time rules

Timestamps are ISO 8601 UTC instants such as `2026-09-06T07:30:00.000Z`; parse as `DateTime`. Appointment `localDate`, `localStartsAt`, `localEndsAt`, and Home Care `preferred_time` represent Baghdad business time (`Asia/Baghdad`). The server validates slot truth and business dates. Do not derive bookability from the device timezone. Notification Today/Yesterday/Previous grouping is a Mobile presentation computed from `createdAt` in `Asia/Baghdad`, not stored server state.

Arabic: استخدم توقيت بغداد لقواعد اليوم والمواعيد، ولا تعتبر توقيت الجهاز مرجعاً لصحة الحجز.
