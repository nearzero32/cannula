# Mobile Demo Data

## Demo account

| Field | Value |
|---|---|
| Phone | `07700000000` |
| PIN | `123456` (**DEMO ONLY**) |
| Name | `مريض كانيولا التجريبي` |

The PIN is persisted only as an Argon2id hash. The seeded account is active and phone-verified. Re-running the seed converges on deterministic IDs (idempotent upserts); `--reset` removes only known seed/dependent IDs before recreating them. Never use these credentials in production.

## Commands and safeguards

```bash
bun run seed:mobile --dry-run
bun run seed:mobile
bun run seed:mobile --reset
```

Default image mode is `remote`; use `--images=none` for nullable optional images. `--json` produces machine-readable output. See Getting Started for remote/production confirmation flags. Dry-run performs zero DB writes and zero hashing.

## Implemented fixture counts

These are **IMPLEMENTED FIXTURE** counts from `scripts/mobile-seed/fixtures.ts`, not a claim about the currently connected database:

| Entity | Count | Entity | Count |
|---|---:|---|---:|
| Specialties | 12 | Clinics | 5 |
| Doctors | 24 | Doctor availabilities | 168 |
| Ads | 6 | Chronic conditions (expected active catalog) | 30 |
| Home Care categories | 4 | Home Care services | 12 |
| Nurses | 6 | Pharmacies | 4 |
| Patient users / Patients | 1 / 1 | Children | 2 |
| Appointments | 7 | Favorites | 5 |
| Home Care requests | 8 | Pharmacy requests | 9 |
| Public notifications | 10 | Targeted notifications | 12 |
| Notification reads | 4 | Suggestions | 6 |
| About Us | 1 | | |

Appointment fixtures cover pending, confirmed, completed, cancelled, and no-show examples. Home Care covers every state except rejected. Pharmacy covers every state except rejected. Dates are generated relative to the Baghdad current date so the dataset remains useful over time.

The seed audits persisted deterministic counts, eligible Doctors, image counts, login hash/verification, read/unread data, and pending push work after a live run. This documentation audit did not run a database seed, so no **LIVE VERIFIED** counts are claimed here; use the command's printed audit/JSON for the target environment.

## Images and push guarantee

Remote mode uses deterministic HTTPS URLs from Unsplash and `placehold.co`; these are development/demo presentation assets, not production-owned clinical media. Optional Doctor/Patient/child/nurse/pharmacy/catalog images become null in `none` mode; Ad images remain required remote banners.

Seeded notifications are inserted as already `sent`, their delivery rows are deleted, and policy specifies `createDeliveryRows: false`. Therefore the demo seed creates no sendable OneSignal push work. Inbox/read-state testing is independent of OneSignal. Audit output explicitly reports `pendingPublicPush` and `pendingUserPush`, expected to be zero.

Arabic: بيانات العرض خيالية وليست مؤسسات أو معلومات مرضى حقيقية، ولا يرسل Seeder إشعارات Push فعلية.

