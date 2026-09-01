# Kanona API

Kanona is a medical appointment scheduling REST API for patients, doctors, clinics, and administrators. The repository is named `cannula` and runs on Bun with Elysia, MongoDB/Mongoose, and Redis.

## Requirements

- Bun 1.3 or newer
- MongoDB replica set or mongos deployment
- Redis

Copy `.env.example` to `.env` and provide the required MongoDB, Redis, JWT, and bootstrap administrator settings.

## Development

```bash
bun install
bun run dev
```

The API listens on `http://localhost:3001/api`. Swagger documentation is exposed by the Elysia Swagger plugin.

To run without watch mode:

```bash
bun run start
```

To run the test suite:

```bash
bun test
```

Transactional MongoDB integration tests run only when `MONGODB_TEST_URI` points to a safe test replica set or mongos deployment.

## Architecture

Requests pass through Elysia controllers, authentication middleware, services, and Mongoose models. Redis stores hashed access and refresh session tokens.

- `src/index.ts` — application bootstrap and integrations
- `src/controller/mobile` — patient/mobile routes under `/api/mobile`
- `src/controller/dash/admin` — administration routes under `/api/dash/admin`
- `src/controller/dash/doctor` — doctor routes under `/api/dash/doctor`
- `src/services` — business and persistence operations
- `src/models` — Mongoose schemas
- `src/migrations` — startup data and password migrations
- `src/docs` — API and domain documentation

## Authentication and passwords

Access tokens expire after 15 minutes and refresh tokens after seven days. Active sessions are stored in Redis using SHA-256 token fingerprints.

Passwords are hashed with Argon2id through `Bun.password`. On startup, the password migration converts legacy SHA-512 hashes to Argon2id using each account's existing `password_show` value. The visible password value is intentionally retained and is not changed by this migration.

The application ensures a super administrator exists at startup. Always set `SUPER_ADMIN_PHONE` and `SUPER_ADMIN_PASSWORD` in production instead of relying on development defaults.

## Docker

```bash
docker compose up --build
```

The Compose stack starts the API, Redis, and a single-node MongoDB replica set. The API is bound to localhost on port `3001` by default. A single-node replica set supports transactions but provides no database high availability; production deployments requiring failover should use a three-node replica set or a managed MongoDB service.

See [the Pharmacy production runbook](src/docs/pharmacy-production-runbook.md) for topology checks, migration order, test commands, and rollback considerations.

## Project conventions

- Controller response messages are written in Arabic.
- Paginated responses use the `pagination` object documented in `CLAUDE.md`.
- Domain records are generally deactivated through status updates rather than hard-deleted.
