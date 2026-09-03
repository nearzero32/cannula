# Authentication abuse protection

Cannula keeps the intentional `nextStep=OTP|PIN` account-discovery behavior. Abuse is bounded with canonical phone normalization, trusted client IPs, and Redis-backed fixed windows. Redis failure returns a safe `503`; authentication never continues without the limiter.

## Limits

- OTP start: 5 per normalized phone and 30 per trusted client IP per 10 minutes.
- OTP resend: 45-second backend cooldown, at most 3 resends per flow, 6 per phone and 30 per IP per 10 minutes.
- OTP verification: the flow has 5 atomic failures; broader ceilings are 20 per phone and 60 per IP per 10 minutes.
- PIN failures: 5 per phone and 30 per IP per 10 minutes. A successful PIN clears only the phone failure counter, not the shared-IP history.
- Support OTP issuance: 10 per Admin per hour, 2 per flow per 10 minutes, and at most 2 persisted issues per AuthFlow.
- Upload intent creation: 10 per authenticated user per minute in Redis; the five-outstanding-resource limit remains in MongoDB.

Redis keys contain HMAC digests rather than phone numbers or IP addresses. The fixed-window Lua script performs `INCR`, first-write `EXPIRE`, and returns allowed, remaining, and TTL atomically.

## Trusted client IP

`TRUSTED_PROXY_CIDRS` is empty by default. In direct mode all forwarding headers are ignored and the Bun socket peer is authoritative. When the immediate peer is trusted, `X-Forwarded-For` is walked right-to-left until the first untrusted hop. Malformed chains are rejected. IPv4-mapped IPv6 addresses normalize to IPv4.

Recommended topology is Internet → Cloudflare → Nginx/Caddy → Bun bound to `127.0.0.1`, with Bun trusting only the local proxy CIDR. The edge proxy must replace—not append untrusted values to—its normalized forwarding chain. `CF-Connecting-IP` is considered only through an already trusted proxy path; Cannula does not hardcode Cloudflare CIDRs.

## OTP lifecycle

Normal and Support OTP hashes may coexist, with one active value of each type. Resend atomically replaces the normal OTP, invalidating the previous value. Issuing Support OTP atomically replaces its predecessor. Verification atomically changes `OTP` to `CREATE_PIN` and clears both hashes, so either type is single-use. Wrong attempts atomically increment only while an active nonmatching challenge exists and stop at five.

AuthFlow lasts 10 minutes, normal OTP 5 minutes, and Support OTP 3 minutes. Plaintext is returned only for development OTP debug or the authorized one-time Support/Admin PIN response and is never persisted or audited. Production SMS still requires `OTP_DELIVERY_WEBHOOK_URL`; without it the deployment status is `PRODUCTION_SMS_PROVIDER_PENDING`.
