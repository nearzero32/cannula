# Known Backend Integration Issues

These are observed current-code discrepancies, not planned features. Mobile documentation follows executable behavior.

## OpenAPI marks runtime-public routes as authenticated

- Endpoint/domain: all public Mobile routes.
- Observed: Swagger configuration applies global bearer security and public routes do not override it; runtime controllers do not require auth.
- Expected/documented: the 26 Public/Optional routes in the reference work without a bearer (guest Notifications still require installation ID).
- Mobile severity: medium; generated clients may incorrectly require a token.
- Suggested follow-up: set route-level `security: []` on runtime-public operations and model optional auth explicitly for Notifications.

## Notification OpenAPI schemas are intentionally `t.Any`

- Endpoint/domain: four `/mobile/notifications` routes.
- Observed: descriptions are accurate but response schemas are `t.Any`, so generated OpenAPI models do not express the inbox/read DTOs.
- Expected/documented: use the concrete structures in `10-notifications.md`.
- Mobile severity: medium for generated clients.
- Suggested follow-up: add strict notification response schemas without changing behavior.

## Child create advertises `photo`, but non-null create is rejected

- Endpoint/domain: `POST /mobile/children`.
- Observed: request schema permits nullable `photo`; service rejects a non-null value with `422 UPLOAD_TARGET_NOT_FOUND` because the child must exist before a purpose-bound upload can target it.
- Expected/documented: create with null/omitted photo, upload with the returned child ID, then PATCH.
- Mobile severity: low when using the documented flow.
- Suggested follow-up: remove non-null `photo` from create schema or document the constraint in OpenAPI.

## `is_featured=false` does not filter false Doctors

- Endpoint/domain: `GET /mobile/doctors` and `/doctors/available`.
- Observed: `true` applies a featured-only filter; `false` is accepted but becomes no featured filter.
- Expected/documented: treat `false` as “no filter,” not “only unfeatured.”
- Mobile severity: low/medium depending on UX.
- Suggested follow-up: either implement explicit false filtering or expose a tri-state query contract.

## Some runtime Pharmacy errors are absent from route response maps

- Endpoint/domain: Pharmacy request create/decision routes.
- Observed: services can emit `400`, `404`, `409`, and upload `503` failures not all enumerated on each controller response map.
- Expected/documented: global/domain error guide includes actual service outcomes.
- Mobile severity: medium for generated clients.
- Suggested follow-up: add the missing response schemas per route.

## Browser guest Notifications cannot send installation header through current CORS policy

- Endpoint/domain: guest Notifications from browser/WebView origins.
- Observed: runtime reads `X-Installation-Id`, while CORS `allowedHeaders` lists only `Content-Type` and `Authorization`.
- Expected/documented: native Mobile networking is unaffected; browser clients need the header allowed.
- Mobile severity: low for native apps, high for browser-based clients.
- Suggested follow-up: add `X-Installation-Id` to CORS allowed headers where browser guest inbox is supported.

## Ordered catalog fields are not returned

- Endpoint/domain: Specialties, Ads, Home Care categories/services.
- Observed: server sorts on `sort_order`/`display_order` but Mobile DTOs omit those fields.
- Expected/documented: preserve array order; do not depend on an order number.
- Mobile severity: low.
- Suggested follow-up: no behavior change required unless offline reordering needs explicit values.

