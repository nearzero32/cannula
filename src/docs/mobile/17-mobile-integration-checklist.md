# Mobile Integration Checklist

## Screen to API matrix

| Screen | Initial API | Secondary API | Auth | Empty/loading/errors |
|---|---|---|---|---|
| Splash/Auth | `POST /auth/start` | OTP/PIN/refresh | public | disable submit; honor 429 |
| Home | Ads, Specialties, Available Doctors, Home Care categories in parallel | Doctor/Home Care detail | public | independent skeletons/partial success |
| Specialties | `GET /specialties` | Doctors filter | public | empty search, paged loading |
| Doctors | `GET /doctors` | detail/favorite | public + favorite auth | empty filters; 400 invalid filter |
| Available Doctors | `GET /doctors/available` | availability | public | empty = no current bookable slots |
| Doctor Detail | `GET /doctors/:id` | availability/favorite | mixed | 404 unavailable |
| Appointments | `GET /appointments` | detail/history | Patient | empty CTA; page spinner |
| Appointment Detail | `GET /appointments/:id` | cancel/reschedule | Patient | obey capabilities; refresh on 409 |
| Home Care | categories/services | create request | mixed | independent catalog placeholders |
| Home Care Request Detail | `GET /home-care/requests/:id` | cancel | Patient | refresh after cancel |
| Pharmacy Request | list/detail | upload/create/decision | Patient | preserve form on upload/network error |
| Notifications | `GET /notifications` | unread/read | optional | persist installation ID; empty is success |
| Profile | `GET /profile` | PATCH profile | Patient | secure auth gate |
| Health Profile | `GET /profile/health` | chronic conditions | Patient | empty arrays are valid |
| Children | `GET /children` | detail/health/upload | Patient | empty CTA; owned 404 |
| Favorites | `GET /doctor-favorites` | add/remove | Patient | optimistic with rollback |
| About Us | `GET /about-us` | — | public | 404 = configuration unavailable |

## Empty-state language

- No Doctors: broaden filters / لا يوجد أطباء مطابقون.
- No available Doctors: no bookable slots now; offer all Doctors / لا توجد مواعيد متاحة حالياً.
- No appointments, Home Care, or Pharmacy requests: show domain-specific create CTA.
- No notifications: “You’re all caught up” / لا توجد إشعارات.
- No favorites: invite Doctor discovery / لم تضف أطباء إلى المفضلة.

## Loading and refresh

Use initial skeletons, a separate bottom pagination indicator, and pull-to-refresh that replaces page 1. Refresh the entity and relevant lists after Appointment cancel/reschedule, Home Care cancel, Pharmacy accept/reject/cancel, and favorite mutation. Notification read endpoints return updated counts, so update locally then reconcile on next refresh. Optimistic mutation is safest for favorite and notification-read; use server-confirmed state for workflow actions.

## Development phases

### AUTH

- [ ] Phone branching without account-existence assumptions
- [ ] OTP verify/resend/recovery and 45-second countdown
- [ ] Six-digit PIN create/login/recovery
- [ ] Secure token storage, single-flight rotation, one retry only
- [ ] Logout/logout-all/session list
- [ ] Forced PIN change

### HOME AND DISCOVERY

- [ ] Independent Ads, Specialties, Available Doctors, Home Care calls
- [ ] Returned ordering preserved
- [ ] Nullable image placeholders
- [ ] Pull-to-refresh/partial failure

### DOCTORS

- [ ] Listing, filters, search, pagination
- [ ] Available Doctors semantics
- [ ] Detail clinics/map nullability
- [ ] Favorites optimistic reconciliation

### APPOINTMENTS

- [ ] Availability and next suggestions
- [ ] SELF and CHILD booking
- [ ] List/detail/history
- [ ] Status labels and capabilities
- [ ] Cancel/reschedule with 409 refresh
- [ ] Baghdad time rendering

### HOME CARE

- [ ] Categories/services/detail
- [ ] SELF/CHILD creation and snapshots
- [ ] List/detail/status matrix
- [ ] Assigned nurse and cancellation

### PHARMACY

- [ ] Private prescription uploads/access
- [ ] Text-only and image request validation
- [ ] List/detail/state matrix
- [ ] Quote version/accepted quotation
- [ ] Accept/reject/cancel and stale refresh

### NOTIFICATIONS

- [ ] Persistent UUID v4 installation ID
- [ ] Guest PUBLIC vs Patient PUBLIC+TARGETED
- [ ] Category/page/unread count
- [ ] Viewer-specific read/read-all
- [ ] Semantic deep links and sensitive push redaction
- [ ] Baghdad Today/Yesterday/Previous grouping

### PROFILE

- [ ] Profile identity and public image upload
- [ ] Health MVP only
- [ ] Chronic-condition lookup
- [ ] Children CRUD/status/health/photo
- [ ] Suggestions and About Us

### RELEASE

- [ ] Global HTTP table implemented
- [ ] GET retry bounded; writes not blindly replayed
- [ ] No secrets/demo PIN in production config
- [ ] Postman smoke test against target environment
- [ ] Empty/loading/offline/accessibility/localized states reviewed

