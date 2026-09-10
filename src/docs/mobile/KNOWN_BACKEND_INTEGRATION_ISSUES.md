# Known Backend Integration Issues

No unresolved Mobile backend integration discrepancies remain from the contract/OpenAPI/CORS audit.

## Resolved in the contract hardening phase

- Runtime-public Mobile operations explicitly override global Bearer security; Notifications advertise guest-or-Bearer optional authentication.
- All four Notification routes use strict reusable response and error schemas instead of `t.Any()`.
- Child creation no longer advertises `photo`; the existing upload-then-PATCH flow remains supported.
- Doctor `is_featured` accepts only `true|false`, documents `false`/omitted as equivalent, and normalizes both to the same filter/cache behavior.
- Mobile Pharmacy response maps now enumerate statuses reachable from each current service call graph. A Pharmacy `503` was not added because ready-reference validation does not access storage; upload intent/completion routes own storage-unavailable outcomes.
- CORS explicitly permits `X-Installation-Id` while retaining `Content-Type`, `Authorization`, explicit origins, methods, and credentials behavior.
- Specialty, Ads, and Home Care ordering is closed by design: the server sorts deterministically and Mobile preserves array order without receiving internal order fields.
