# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun run dev    # Start development server with watch mode on port 3000
```

No test runner or linter is currently configured.

## Project

**Kanona** is a doctor appointment booking platform (the repo is named `cannula`). It connects patients, doctors, clinics, and admins in one system. The codebase is a REST API built with [Elysia](https://elysiajs.com/) on the Bun runtime, backed by MongoDB (Mongoose) and Redis.

### Roles

- **Patient** — self-registers; browses doctors/clinics, books and manages appointments
- **Doctor** — managed account created by admin; linked to clinics and a specialty; configures booking defaults (slot interval, buffer times, fees, auto-booking)
- **Admin** — manages all entities; has fine-grained `permissions[]` (e.g. `manage_doctors`, `verify_doctors`, `view_reports`); `superAdmin` flag bypasses permission checks

### MVP Scope

Included: auth, roles, patient/doctor/admin profiles, clinics, specialties, appointment CRUD and status workflow.

Excluded (future phases): ratings/reviews, video consultations, payments, notifications, medical records, prescriptions, queue system, availability exceptions, doctor verification documents.

### Booking Flows

**Patient books appointment:**

1. Patient registers → `User` (role `patient`) + `Patient` profile created
2. Patient browses specialties/doctors, selects clinic + time slot
3. `Appointment` record created (`pending`)

**Admin creates doctor:**

1. Admin creates `User` (role `doctor`) + `Doctor` profile
2. Admin links doctor to specialty and clinic(s)
3. Doctor becomes bookable when `Doctor.status = active`

### Appointment Status Workflow

`pending → confirmed → completed` or `cancelled` / `no_show`

**Anti-double-booking:** unique compound index on `doctorId + date + startTime` is required.

## Architecture

Cannula is a **medical appointment scheduling REST API** built with [Elysia](https://elysiajs.com/) on the Bun runtime, backed by MongoDB (Mongoose) and Redis.

### Request Lifecycle

```
HTTP Request → Elysia router → AuthPlugin middleware → Controller → Service → Mongoose model → MongoDB
                                        ↕
                                   Redis cache (auth session, 1h TTL)
```

Every protected route passes through `src/middleware/auth.middleware.ts`, which:
1. Extracts the Bearer token from the `Authorization` header
2. Verifies the JWT signature via `verifyTokenInJwt()`
3. Looks up the SHA256-hashed token in Redis; falls back to the `AccountAuth` MongoDB collection on cache miss

### Layer Responsibilities

| Layer | Path | Purpose |
|---|---|---|
| Entry point | `src/index.ts` | Elysia app bootstrap, plugin registration |
| Controllers | `src/controller/` | Route definitions, request/response shape |
| Services | `src/services/` | Business logic, orchestrates DB calls |
| Models | `src/models/` | Mongoose schemas and enums |
| Interfaces | `src/interfaces/` | TypeScript types mirroring the models |
| Databases | `src/databases/` | MongoDB connection pool + Redis client |
| Constants | `src/constants/` | JWT config, hashing helpers, Swagger config |

Controllers are split by client type: `controller/dash/` (admin dashboard) and `controller/mobile/` (mobile app, currently empty).

### Core Domain Models

- **Account / AccountAuth** — base authentication; `AccountAuth` tracks active JWT sessions
- **User → Doctor / Patient** — User is the base profile; Doctor and Patient extend it
- **Clinic** — medical facility with working hours and assigned doctors
- **Appointment** — links Doctor + Patient + Clinic; has a status enum workflow (`pending → active → completed`)
- **Specialty** — medical specialties referenced by Doctors
- **Admin** — administrative accounts with role-based access

### Environment Variables

Required in `.env`:

```
# Auth
ACCESS_TOKEN_SECRET=
REFRESH_TOKEN_SECRET=

# MongoDB
MONGODB_URI=mongodb://localhost:27017/cannula

# Redis
REDIS_HOST=
REDIS_PORT=6379

# Optional integrations
FIREBASE_SERVER_KEY=
AWS_ACCESS_KEY_ID=, AWS_SECRET_ACCESS_KEY=, AWS_S3_BUCKET_NAME=, AWS_S3_ENDPOINT=
SMTP_HOST=, SMTP_USER=, SMTP_PASS=
REVERSE_GEOCODE_URL=
QI_UAT_PAYMENT_BASE_URL=, QI_PAYMENT_BASE_URL=
```

### Key Conventions

- Passwords are hashed with **SHA-512** via Bun's `CryptoHasher`
- Auth tokens are stored in Redis as their **SHA-256 hash** (not the raw token) for cache lookups
- Swagger docs are auto-generated and served via `@elysiajs/swagger`
- TypeScript target is ES2021; Bun handles transpilation natively (no build step needed for dev)
- **No hard deletes** — services must never implement `deleteById` or any `findByIdAndDelete` call; records are deactivated via a `status` field update instead. Controllers expose `PATCH /:id/status` for status changes, never a `DELETE` endpoint.
- **All response messages must be in Arabic.** Every `message` string returned from a controller must be written in Arabic (e.g. `'تم جلب البيانات بنجاح'`, `'غير موجود'`). No English messages in controller responses.
- **Pagination response shape** — all paginated list endpoints must return:
  ```ts
  {
    error: false,
    message: '...Arabic...',
    data: [...],
    pagination: { page, limit, total, pages, hasNext, hasPrev }
  }
  ```
  Use `const totalPages = Math.ceil(count / limit)` then derive `hasNext: page < totalPages` and `hasPrev: page > 1`. Never use a `meta` key.
