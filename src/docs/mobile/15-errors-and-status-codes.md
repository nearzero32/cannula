# Errors, HTTP Statuses, and Enum Reference

## Global handling

| Status | Meaning | Refresh token? | Retry? | UX / refresh entity |
|---:|---|---:|---:|---|
| `400` | malformed/invalid input | no | after correction | show field/message; no entity refresh normally |
| `401` | missing/invalid/expired/revoked Mobile auth | once for protected access-token failure | original once after successful refresh | otherwise logout |
| `403` | authenticated but forbidden/restricted/wrong role | no | no | show access/PIN-change message |
| `404` | missing, inactive, invisible, or not owned | no | no | show unavailable; refresh/remove entity |
| `409` | state, slot, quote version, duplicate, concurrency | no | only after refetch/user choice | refresh current entity/availability |
| `422` | schema/business validation | no | after correction | map validation or show message |
| `429` | rate limit | no | after `Retry-After` | disable action/countdown |
| `500` | safe internal failure | no | bounded/manual | preserve input and show retry |
| `503` | Redis/storage/OTP/dependency unavailable | no | bounded backoff | temporary outage message |

An auth refresh itself returning `401` ends the session. Never infinite-loop or refresh on `403`/`409`.

## Mobile-facing domain code catalog

Codes are present only when a `DomainError` reaches a handler that includes `code`; some profile/child/Home Care paths return message only.

- Auth: `AUTH_PHONE_INVALID`, `AUTH_FLOW_INVALID`, `AUTH_FLOW_EXPIRED`, `AUTH_OTP_INVALID`, `AUTH_OTP_EXPIRED`, `AUTH_OTP_ATTEMPTS_EXCEEDED`, `AUTH_OTP_RESEND_COOLDOWN`, `AUTH_OTP_RESEND_LIMIT`, recovery-prefixed equivalents, `AUTH_PIN_INVALID`, `AUTH_PIN_ATTEMPTS_EXCEEDED`, `AUTH_REFRESH_INVALID`, `AUTH_REFRESH_REUSED`, `AUTH_SESSION_REVOKED`, `AUTH_WRONG_AUDIENCE`, `REFRESH_ACCOUNT_INVALID`, `OTP_PROVIDER_FAILURE`, `AUTH_SECURITY_UNAVAILABLE`, `AUTH_RATE_LIMIT_UNAVAILABLE`, `SESSION_STORE_UNAVAILABLE`.
- Profile/children: many validation/ownership failures have no stable code; use `400/403/404/422`. Chronic condition validation is message-based.
- Doctors: `SPECIALTY_INVALID`, `CLINIC_INVALID`, `INVALID_OBJECT_ID`, `INVALID_FEATURED_FILTER` (some controller responses omit code).
- Appointments: `APPOINTMENT_INVALID`, `APPOINTMENT_DATE_INVALID`, `APPOINTMENT_TIME_INVALID`, `APPOINTMENT_NOT_FOUND`, `APPOINTMENT_NOT_OWNED`, `APPOINTMENT_BENEFICIARY_INVALID`, `DOCTOR_NOT_BOOKABLE`, `DOCTOR_NOT_AT_CLINIC`, `SPECIALTY_INVALID`, `APPOINTMENT_TOO_SOON`, `APPOINTMENT_DAILY_CAP_REACHED`, `APPOINTMENT_SLOT_UNAVAILABLE`, `APPOINTMENT_INVALID_TRANSITION`, `APPOINTMENT_CANCELLATION_WINDOW_CLOSED`, `APPOINTMENT_RESCHEDULE_NOT_ALLOWED`.
- Home Care: current Mobile handler omits codes; use status/message. Expected statuses include `400` invalid IDs/input, `404` unavailable/not-owned, `409` invalid cancellation state, `422` inactive service/child/date rule.
- Pharmacy: `INVALID_IDENTIFIER`, `INVALID_INPUT`, `INVALID_PRESCRIPTION_IMAGES`, `TREATMENT_CONTENT_REQUIRED`, `CHILD_NOT_ACTIVE`, `INVALID_DELIVERY_ADDRESS`, `PHARMACY_REQUEST_NOT_FOUND`, `QUOTATION_NOT_ACTIVE`, `STALE_QUOTATION_VERSION`, `STALE_WORKFLOW_VERSION`, `INVALID_STATE_TRANSITION` plus upload codes.
- Notifications: `INVALID_INSTALLATION_ID`, `NOTIFICATION_GUEST_RATE_LIMITED`; invisible notification read returns `404` without code.
- Uploads: `UPLOAD_PURPOSE_FORBIDDEN`, `UPLOAD_CONTENT_TYPE_UNSUPPORTED`, `UPLOAD_TARGET_NOT_FOUND`, `UPLOAD_TARGET_NOT_OWNED`, `UPLOAD_RATE_LIMITED`, `UPLOAD_NOT_FOUND`, `UPLOAD_ALREADY_REJECTED`, `UPLOAD_EXPIRED`, `UPLOAD_VALIDATION_IN_PROGRESS`, `UPLOAD_OBJECT_MISSING`, `UPLOAD_TOO_LARGE`, `UPLOAD_CONTENT_MISMATCH`, `UPLOAD_VALIDATION_FAILED`, `UPLOAD_NOT_READY`, `UPLOAD_PURPOSE_MISMATCH`, `UPLOAD_ALREADY_ATTACHED`, `STORAGE_UNAVAILABLE`.

## Mobile enum appendix

- Gender: `male`, `female`.
- Patient status: `active`, `inactive`, `blocked` (read-only to Mobile).
- Blood type: `A+`, `A-`, `B+`, `B-`, `AB+`, `AB-`, `O+`, `O-`.
- Child relationship: `son`, `daughter`, `brother`, `sister`, `grandson`, `granddaughter`, `other`; child status `active|inactive`.
- Appointment beneficiary: `SELF|CHILD`; status `pending|confirmed|checked_in|in_progress|cancelled|completed|no_show|rescheduled`; booking source `app|admin_panel|phone`; payment status `unpaid|paid|refunded|partial`.
- Appointment availability: `AVAILABLE|DAILY_CAP_REACHED|FULLY_BOOKED|DOCTOR_CLOSED|NO_WORKING_HOURS|NO_VALID_SLOT|NO_UPCOMING_AVAILABILITY`.
- Home Care status: `pending|confirmed|assigned|on_the_way|arrived|in_progress|completed|cancelled|rejected`; cancellation actor `PATIENT|ADMIN`.
- Pharmacy status: `open|under_review|waiting_customer_approval|confirmed|preparing|ready_for_delivery|out_for_delivery|delivered|cancelled|rejected`; payment method `cash_on_delivery|card`.
- Notification audience `public|targeted`; privacy `normal|sensitive`; categories `appointments|medications|results|services|account|system`; types are listed in the Notifications chapter.
- Mobile upload purposes: `PATIENT_PROFILE_PHOTO|PATIENT_CHILD_PHOTO|PRESCRIPTION_IMAGE`; visibility `PUBLIC|PRIVATE`.

Arabic: افصل الحالة الفارغة الناجحة (`data: []`) عن الخطأ، واعتمد قيمة enum الخام للموديل مع تسمية واجهة محلية.

