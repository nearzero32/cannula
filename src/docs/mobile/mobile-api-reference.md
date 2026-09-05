# Mobile API Reference

Base: `{{baseUrl}}/mobile`, where local `baseUrl` is `http://localhost:3001/api`. `Public` means no bearer token. `Optional` means guest without `Authorization`, but any supplied token must be valid. Protected routes require `Authorization: Bearer <accessToken>`, role `patient`, audience `mobile`. JSON bodies require `Content-Type: application/json`.

Standard page query fields are strings parsed to positive integers; controllers clamp limits. Common failures are `400`, `401`, `403`, `404`, `409`, `422`, `429`, `500`, and dependency `503` as declared per route. Consult the domain chapter and [error guide](15-errors-and-status-codes.md).

## Inventory (66 routes)

| Method and path | Auth | Input / success / notable behavior |
|---|---|---|
| `GET /mobile/about-us` | Public | `200` data; `404` unconfigured |
| `GET /mobile/ads` | Public | `page,limit`; `200` page; 60s cache |
| `GET /mobile/ads/:id` | Public | ad ID; `200`; `400/404` |
| `GET /mobile/appointments/availability` | Patient | `doctorId,clinicId,date,specialtyId?`; `200` |
| `GET /mobile/appointments` | Patient | `page,limit,status,view`; `200` page |
| `POST /mobile/appointments` | Patient | booking JSON; `201`; creates history/notifications/reminders |
| `GET /mobile/appointments/:id` | Patient | owned ID; `200`; `404` hides ownership |
| `GET /mobile/appointments/:id/history` | Patient | owned ID; `200` chronological events |
| `POST /mobile/appointments/:id/cancel` | Patient | `{reason?}`; `200`; frees slot/cancels reminders |
| `POST /mobile/appointments/:id/reschedule` | Patient | destination JSON; `200` replacement; old becomes rescheduled |
| `POST /mobile/auth/start` | Public | `{phone}`; `200` flow |
| `POST /mobile/auth/otp/resend` | Public | `{flowId}`; `200`; cooldown/limits |
| `POST /mobile/auth/otp/verify` | Public | `{flowId,otp}`; `200` next step |
| `POST /mobile/auth/pin/forgot/start` | Public | `{phone}`; `200` recovery flow |
| `POST /mobile/auth/pin/forgot/resend` | Public | `{flowId}`; `200` |
| `POST /mobile/auth/pin/forgot/verify` | Public | `{flowId,otp}`; `200` |
| `POST /mobile/auth/pin/forgot/reset` | Public | `{flowId,pin,confirmPin,device*?}`; `200` tokens; revokes old sessions |
| `POST /mobile/auth/pin/create` | Public | `{flowId,pin,device*?}`; `201` account/tokens |
| `POST /mobile/auth/pin/login` | Public | `{flowId,pin,device*?}`; `200` tokens |
| `POST /mobile/auth/refresh` | Public | `{refreshToken}`; `200` rotated token pair |
| `POST /mobile/auth/pin/change-required` | Patient | `{pin}`; `200` replacement tokens |
| `GET /mobile/auth/sessions` | Patient | `200` session array |
| `POST /mobile/auth/logout` | Patient | `200`, no data; revokes current |
| `POST /mobile/auth/logout-all` | Patient | `200`, no data; revokes all |
| `GET /mobile/children` | Patient | `include_inactive?`; `200` array |
| `POST /mobile/children` | Patient | child JSON; `201` |
| `GET /mobile/children/:childId` | Patient | owned ID; `200` |
| `PATCH /mobile/children/:childId` | Patient | partial child JSON; `200` |
| `PATCH /mobile/children/:childId/status` | Patient | `{status}`; `200` |
| `GET /mobile/children/:childId/health-profile` | Patient | `200` |
| `PATCH /mobile/children/:childId/health-profile` | Patient | health MVP JSON; `200` |
| `GET /mobile/chronic-conditions` | Public | `page,limit,search`; `200` active page |
| `GET /mobile/doctor-favorites` | Patient | `page,limit`; `200` page |
| `POST /mobile/doctor-favorites` | Patient | `{doctor_id}`; `201`; `409` duplicate |
| `DELETE /mobile/doctor-favorites/:doctor_id` | Patient | `200`; `404` absent |
| `GET /mobile/doctors` | Public | filters/page; `200` page |
| `GET /mobile/doctors/available` | Public | filters/page; `200` real bookability; 30s cache |
| `GET /mobile/doctors/:id` | Public | `200` detail/clinics; `400/404` |
| `POST /mobile/home-care/requests` | Patient | request JSON; `201`; snapshots service |
| `GET /mobile/home-care/requests` | Patient | `page,limit,status`; `200` page |
| `GET /mobile/home-care/requests/:id` | Patient | owned ID; `200` |
| `PATCH /mobile/home-care/requests/:id/cancel` | Patient | `{reason?}`; `200`; `409` state |
| `GET /mobile/home-care/categories` | Public | `200` ordered array; 300s cache |
| `GET /mobile/home-care/services` | Public | `categoryId?`; `200` ordered array; 300s cache |
| `GET /mobile/home-care/services/:id` | Public | `200`; `400/404` |
| `GET /mobile/notifications` | Optional | `page,limit,category`; `200` page + unread count |
| `GET /mobile/notifications/unread-count` | Optional | `200` without message |
| `PATCH /mobile/notifications/read-all` | Optional | `200` counts; guest write rate limit |
| `PATCH /mobile/notifications/:id/read` | Optional | `200` count; `404` invisible; idempotent |
| `POST /mobile/pharmacy-requests` | Patient | treatment JSON; `201`; attaches private assets |
| `GET /mobile/pharmacy-requests` | Patient | `page,limit,status`; `200` page |
| `GET /mobile/pharmacy-requests/:id` | Patient | owned ID; `200` |
| `PATCH /mobile/pharmacy-requests/:id/cancel` | Patient | `{reason?}`; `200` |
| `PATCH /mobile/pharmacy-requests/:id/accept-quote` | Patient | `{quotation_version}`; `200` |
| `PATCH /mobile/pharmacy-requests/:id/reject-quote` | Patient | `{quotation_version,reason?}`; `200`, reopens |
| `GET /mobile/profile/health` | Patient | `200` health MVP |
| `PATCH /mobile/profile/health` | Patient | health MVP JSON; `200` |
| `GET /mobile/profile` | Patient | `200` merged profile summary |
| `PATCH /mobile/profile/complete-profile` | Patient | identity JSON; `200` |
| `GET /mobile/specialties` | Public | `page,limit,search`; `200` page; 300s cache |
| `GET /mobile/specialties/:id` | Public | `200`; `400/404` |
| `GET /mobile/suggestions` | Patient | `page,limit`; `200` page |
| `POST /mobile/suggestions` | Patient | `{suggestion}`; `201` |
| `POST /mobile/upload/intents` | Patient | `{purpose,targetId?,contentType}`; `201` signed PUT |
| `POST /mobile/upload/intents/:uploadId/complete` | Patient | UUID path; `200` managed reference |
| `GET /mobile/upload/assets/:uploadId/access` | Patient | UUID path; `200` 5-minute private GET/public URL |

## Global side effects and retry notes

Auth creates/revokes Redis sessions. Appointment, Home Care, and Pharmacy writes create history and relevant targeted notification work. Upload completion validates/promotes storage objects. Notification reads create viewer-specific receipts. Favorite/suggestion/profile/child writes are activity-audited. No create/booking endpoint exposes an idempotency key; resolve uncertain writes by refetching before retry.
