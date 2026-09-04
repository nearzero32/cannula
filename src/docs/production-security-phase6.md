# Cannula production security runbook

## Security boundary

The supported topology is Internet → Cloudflare → an HTTPS reverse proxy → Cannula. Bun may listen on the private container network; only the reverse proxy publishes the API. MongoDB and Redis have no host ports in `compose.yml`. `TRUSTED_PROXY_CIDRS` must contain only the immediate proxy networks and the proxy must replace client forwarding headers. CORS protects browsers only and is not authorization.

Production startup fails before database connections when critical configuration is missing or unsafe. Generate each authentication secret independently with `openssl rand -hex 32`; never reuse access, refresh, OTP-HMAC, Swagger, Mongo, or Redis secrets. Keep `.env` and the Mongo replica-set key file outside Git, restrict them to the deployment account, and rotate a secret after suspected disclosure. JWT secret rotation invalidates tokens; session validation remains fail-closed through Redis.

## Required production configuration

- `NODE_ENV=production`, `PUBLIC_HTTPS=true`, three independent 32+ character `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`, and `OTP_HASH_SECRET` values, and `OTP_DEBUG_RETURN_CODE=false`.
- An exact HTTPS `ALLOWED_ORIGINS` list. Origins contain scheme, host, and optional port only. Native mobile clients do not rely on CORS.
- Authenticated `MONGODB_URI` (or `MONGODB_USER`/`MONGODB_PASSWORD`) and a replica set. Use `MONGODB_TLS=true` across an untrusted network, or explicitly declare the same-host private boundary with `MONGODB_INTERNAL_NETWORK=true`.
- Non-empty `REDIS_PASSWORD`. Use `REDIS_TLS=true` (`rediss://` is selected by the adapter) for remote Redis, or `REDIS_INTERNAL_NETWORK=true` for the private same-host Compose network.
- Complete HTTPS R2 settings whenever any R2 value is supplied. R2 tokens should be bucket-scoped Object Read/Write credentials, with a separate private bucket. Cloudflare must enforce HTTPS and limit request size consistently with the API.

Swagger is enabled by default only outside production. Whenever enabled, it requires `SWAGGER_USERNAME` and a random 32+ character `SWAGGER_PASSWORD`. Swagger UI and JSON are protected with browser-native HTTP Basic authentication; API JWT Bearer authentication remains separate. Prefer leaving both UI and JSON disabled publicly.

The default API body limit is 2 MiB (`REQUEST_BODY_LIMIT_BYTES`, bounded to 64 KiB–10 MiB). Upload bytes go directly to R2. Query strings over 8 KiB are rejected. Security headers and a server-generated `X-Request-Id` are returned on normal and error paths. HSTS is emitted only in production, where the supported topology guarantees public HTTPS.

## MongoDB

`compose.yml` pins MongoDB 8.2.12, enables replica-set internal authentication using `MONGODB_KEYFILE_PATH`, initializes a root operator, then creates the application user with the `readWrite` role only on the `cannula` database. Generate the key file on Linux with `openssl rand -base64 756 > secrets/mongo-keyfile && chmod 400 secrets/mongo-keyfile`. Administrative credentials are used by Mongo initialization and are not passed to the API container.

The application role supports CRUD and collection index creation required by current migrations. Do not grant cluster-admin roles. Back up and restore-test Mongo before deployment. The private Docker network is isolation, not encryption; enable Mongo TLS when crossing hosts or networks.

## Redis

`compose.yml` pins Redis 7.4.11, requires authentication, publishes no host port, enables AOF, and uses `maxmemory-policy noeviction`. Monitor memory and size capacity with headroom: silently evicting session, refresh tombstone, or brute-force limiter keys can weaken security semantics. A Redis loss/restart may sign users out; access JWTs are not accepted when their Redis session is absent. For remote managed Redis, require TLS, authentication/ACLs, private networking, backups only if session continuity is required, and tested failover.

## Containers and runtime

The API runs as Bun's non-root user with all Linux capabilities dropped, `no-new-privileges`, a read-only root filesystem, a bounded `/tmp`, bounded logs, memory/CPU limits, and no Docker socket. Images are pinned to tested patch versions. `.dockerignore` excludes secrets, Git metadata, tests, logs, coverage, and local artifacts. Review upstream security releases before changing pins.

Liveness is `GET /api/health/live`; readiness is `GET /api/health/ready`. Readiness performs short lightweight Mongo and Redis pings and returns only `ready` or `not_ready`. The deploy workflow gates SSH deployment on typecheck, tests, real Redis integration, and build, then waits for readiness. Restrict the SSH key to the deployment user, disable password/root SSH, pin the host key at the runner/network layer, and protect the `main` environment with required reviewers.

SIGTERM/SIGINT stops accepting traffic, allows up to ten seconds for in-flight requests, then closes Redis and Mongo. Configure the orchestrator termination grace period above twelve seconds.

## Deployment and rollback

1. Back up Mongo and verify free Redis memory; create the key file and secrets with restrictive permissions.
2. Run `docker compose config -q`, typecheck, all tests, integration tests, and the production build.
3. Deploy one instance, wait for readiness, then test login, refresh, logout, R2 upload intent/finalize, Pharmacy transaction, and Appointment booking.
4. Confirm Swagger is absent, CORS rejects an unlisted origin, security headers exist, and logs contain request metadata but no credentials or medical bodies.
5. Roll back to the last tested application/image set if readiness or smoke tests fail. Do not roll back data migrations blindly; restore the verified backup only under the migration-specific runbook.

Incident response: remove the instance from traffic, preserve sanitized logs by request ID, rotate affected credentials, revoke sessions when auth secrets may be exposed, inspect AuthEvent/ActivityLog, patch, rerun all gates, and document scope and notification decisions.

## Residual operational decisions

Cloudflare TLS mode must be Full (strict), the origin certificate must be valid, proxy request/time limits must match the application, and rate limiting/WAF rules should complement—not replace—the application limiters. Alert on readiness failure, Redis memory, Mongo replication lag/storage, repeated 401/429/5xx events, and container restarts. Dependency audit findings require human reachability review and a tested upgrade; do not auto-upgrade major versions in production.
