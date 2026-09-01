# Pharmacy Treatment Request production runbook

## MongoDB requirement

Pharmacy Treatment Request mutations write the request and its append-only domain history in one MongoDB transaction. The API must therefore connect through `MONGODB_URI` to either:

- a replica set, using a URI such as `mongodb://host1,host2,host3/cannula?replicaSet=<name>`;
- a managed MongoDB Atlas SRV deployment; or
- a mongos-backed sharded deployment.

Application startup runs `hello` after connecting and stops before migrations or HTTP traffic when the server is standalone. The error does not include the connection URI or credentials.

The checked-in Compose stack initializes `MONGODB_REPLICA_SET_NAME` (default `rs0`) as a single-node replica set. It supports transactions but has **no high availability**. A three-node replica set or managed service adds election/failover capability.

Verify topology with an authenticated administrative shell without printing the URI:

```javascript
const hello = db.adminCommand({ hello: 1 })
printjson({ replicaSet: hello.setName ?? null, mongos: hello.msg === "isdbgrid", writablePrimary: hello.isWritablePrimary ?? null })
```

`setName` must be present or `mongos` must be `true`. Never log or paste credentials from `MONGODB_URI`.

## Migration and startup order

The application connects, validates transaction topology, runs startup migrations, and only then starts listening for traffic. `backfillPharmacyWorkflow()`:

1. sets `workflowVersion: 0` only where the field is missing;
2. creates a missing immutable accepted-quotation snapshot for accepted/fulfillment states;
3. preserves existing workflow versions and timestamps; and
4. is safe to rerun.

Before the first hardened deployment, take a database backup and rehearse against a restored test database. After startup, verify that no Pharmacy request lacks `workflowVersion`, review the migration counts, and confirm accepted/fulfillment requests have `accepted_quotation`. Do not run destructive integration or migration tests against production.

Rollback of the application should use the pre-deployment image and the database backup when data rollback is required. The migration is additive, so do not delete version or accepted-snapshot fields merely to roll back application code.

## Transactional integration tests

Set a dedicated, disposable transaction-capable test URI:

```powershell
$env:MONGODB_TEST_URI='mongodb://localhost:27018/cannula_pharmacy_test?replicaSet=rs0&directConnection=true'
bun test tests/pharmacy-treatment-request.mongodb.test.ts
```

The suite creates a uniquely named database and drops only that database. `MONGODB_TEST_URI` is separate from production `MONGODB_URI`; never point it at production or an unknown shared database. Unit and static tests remain runnable without MongoDB and skip only the explicitly gated integration suites.

## Prescription object security

Pharmacy API authorization protects stored prescription references, but the current upload service returns `R2_PUBLIC_URL` object URLs and has no signed-download path. Before storing production prescriptions, use a private bucket, persist object keys rather than permanent public URLs, and resolve authorized reads through short-lived signed download URLs. This storage hardening is separate from Pharmacy workflow correctness.

## Operational boundaries

Post-confirmation fulfillment is Pharmacy-only: `confirmed → preparing → ready_for_delivery → out_for_delivery → delivered`. It does not assign drivers, track locations, collect payments, or change accepted commercial terms. ActivityLog remains outside the critical transaction; failures are logged and cannot undo an already committed request/history transaction.
