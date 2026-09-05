# Mobile demo data seed

`seed:mobile` is a development/staging CLI that fills the current Cannula Mobile surfaces with deterministic demonstration data. It is not a migration and it is not production bootstrap data.

## Commands

Configure `SEED_MONGODB_URI` or `MONGODB_URI` and run:

```bash
bun run seed:mobile
```

For local execution, the seed-only URI takes precedence without changing the application's normal connection setting:

```text
SEED_MONGODB_URI -> MONGODB_URI
```

When Bun runs on the Windows host while MongoDB runs in Docker, `mongo` is only a Docker-network hostname. Point the seeder at the published host port instead. PowerShell example:

```powershell
$env:SEED_MONGODB_URI = "mongodb://<user>:<password>@127.0.0.1:27017/cannula?authSource=cannula&replicaSet=rs0&directConnection=true"
bun run seed:mobile
```

Bash-compatible example:

```bash
SEED_MONGODB_URI="mongodb://<user>:<password>@127.0.0.1:27017/cannula?authSource=cannula&replicaSet=rs0&directConnection=true" bun run seed:mobile
```

The seeder does not rewrite or mutate `MONGODB_URI`.

Safely remove only known seed records and recreate them:

```bash
bun run seed:mobile -- --reset
```

Preview entity counts, connection metadata, and reset scope without connecting, hashing a PIN, or writing data:

```bash
bun run seed:mobile -- --dry-run
bun run seed:mobile -- --reset --dry-run
```

For an explicitly selected staging/remote database:

```bash
SEED_MONGODB_URI="mongodb://host/cannula_stage" bun run seed:mobile -- --target=remote --allow-remote
```

The CLI prints only the Mongo host and database name; credentials are never printed. A production-like host/database name or `NODE_ENV=production` is refused unless both dangerous confirmations are supplied:

```bash
bun run seed:mobile -- --allow-production-seed --confirm=CANNULA_DEMO_DATA
```

Production seeding remains discouraged even with this escape hatch.

## Demo account

- Phone: `07700000000`
- PIN: `123456`

The PIN is hashed through the application's `hashPassword()` helper. No plaintext PIN/password field is stored.

## Dataset

The full profile includes 12 specialties, 5 fictitious Baghdad clinics, 24 verified active doctors (8 featured), 168 weekly availability rows, 6 image-only ads, the existing 30-condition chronic-condition catalog, 4 Home Care categories, 12 Home Care services, 6 nurses, 4 pharmacies, and one complete Patient identity.

The Patient owns a health profile, two children and child health profiles, five favorite doctors, seven appointments, eight Home Care requests, nine pharmacy treatment requests, six suggestions, ten public notifications, and twelve targeted notifications. Four targeted notifications have authoritative `NotificationRead` receipts and eight remain unread. Dates are calculated relative to the current Baghdad date.

The CLI uses the actual current models and status enums. It inserts historical/demo workflow states directly and never calls Appointment, Home Care, Pharmacy, or notification workflow services.

## Images

`--images=remote` is the default and uses a fixed manifest of public HTTPS demonstration images. URLs are deterministic and contain no credentials. The CLI does not download or upload assets to R2.

Use `--images=none` to leave optional profile/catalog images null. Ads retain a safe fixed HTTPS image because their schema requires one.

## Idempotency and reset safety

Seed ObjectIds are derived from the first 24 hexadecimal characters of:

```text
SHA-256("cannula-mobile-seed:<entity>:<key>")
```

Records are upserted by these IDs, so rerunning converges without duplicates. Existing bootstrap Home Care categories are reconciled by their established `seed_key` or normalized name.

`--reset` never drops a database and never uses an unscoped deletion. It deletes only explicit deterministic seed IDs and notification deliveries whose parent ID is one of the known demo notification IDs. Existing chronic-condition/bootstrap rows and reconciled pre-existing categories are preserved. Reset then reseeds.

To disable the dataset, run `--reset` and stop the process after the reset phase only by interrupting before reseeding is **not** recommended; there is intentionally no reset-only mode. Re-running the normal seed is the supported recovery path.

## No-real-push guarantee

Seeded inbox notifications are terminal `sent` records created directly through Mongo models. No `NotificationDelivery` rows are created. The CLI also removes any delivery rows attached to its known notification IDs, and never calls OneSignal, a delivery worker, `dispatch`, or `createAndDispatch`. It cannot create a pending public broadcast.

## Cache invalidation

After Mongo writes, the CLI attempts to remove Mobile specialty, available-doctor, Home Care, and Ads cache keys. Redis is optional: missing or unavailable Redis produces a clear warning without rolling back otherwise useful Mongo demo data.

## JSON summary

Add `--json` for a machine-readable final summary containing the demo Patient IDs and all Doctor, Specialty, and Clinic IDs. IDs are printed only; no generated files are written.
