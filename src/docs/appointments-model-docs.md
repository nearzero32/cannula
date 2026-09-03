# Appointment scheduling domain

Cannula's appointment domain is authoritative: clients choose a generated start instant, while the backend validates the current schedule and calculates duration and blocked bounds. There is no compatibility contract with the disposable pre-launch appointment schema.

## Time policy

- Business timezone: `Asia/Baghdad`.
- Availability and exceptions store local `HH:mm` periods plus Baghdad calendar dates.
- Appointment start/end and blocked bounds are UTC `Date` instants.
- `local_date` is the indexed Baghdad date used for the doctor/day lock. API DTOs expose UTC ISO instants and derived Baghdad date/time.

## Storage

`Appointment` stores references, beneficiary/source, actual and buffered intervals, workflow state/timestamps/version, cancellation actor, reschedule links, internal notes, payment status, and immutable doctor, clinic, specialty, beneficiary and fee/currency snapshots.

`DoctorAvailability` stores one unique doctor/clinic/day record with zero or more non-overlapping local periods. Multiple periods represent breaks; slots are never persisted.

`DoctorAvailabilityException` stores one doctor/date/global-or-clinic override. `CLOSED` yields no periods and `CUSTOM_HOURS` replaces weekly periods.

`AppointmentHistory` stores ordered domain events. `AppointmentCounter` atomically issues `APP-YYYY-NNNNNN`. `AppointmentDayLock` serializes booking decisions for a doctor and Baghdad date inside MongoDB transactions.

## Daily booking capacity

`Doctor.max_appointments_per_day` is required, defaults to `30`, and is constrained to `1..200`. Missing development records are treated/backfilled as 30. Doctor Dashboard may edit only the authenticated doctor's value; Admin may edit any doctor's value through the `manage_availability` settings route.

The cap is global per `doctor_id + local_date` in `Asia/Baghdad`, across every clinic. `pending`, `confirmed`, `checked_in`, `in_progress`, `completed`, and `no_show` count; `cancelled` and `rescheduled` release capacity. Lowering a cap never changes existing appointments—it only makes remaining capacity zero until the count drops below the cap.

The existing doctor/day lock serializes the final count and exact-slot revalidation inside the Mongo transaction. Same-day rescheduling excludes its source appointment; destination failure rolls the whole reschedule back.

## Slot calculation

The slot service validates that the doctor is active, verified, licensed, accepting patients, belongs to the active clinic, and provides an optional active specialty assigned through `Doctor.specialty_ids` ObjectId references. It checks the global daily cap before loading schedule detail, then loads the weekly rule, most-specific exception, settings, and blocking appointments. Candidate starts advance by `slot_interval`; duration may differ. Duration plus buffers must fit the period. Past/lead-time and half-open buffered overlaps are removed. Booking recomputes the exact slot and daily count inside its transaction.

Focused availability returns `availabilityStatus`, `dailyCapacity`, public slots, and up to three `nextAvailableOptions`. Statuses are `AVAILABLE`, `DAILY_CAP_REACHED`, `FULLY_BOOKED`, `DOCTOR_CLOSED`, `NO_WORKING_HOURS`, `NO_VALID_SLOT`, and `NO_UPCOMING_AVAILABILITY`. Suggestions scan at most 30 subsequent calendar days by default (hard maximum 90), use the same doctor and clinic, and call the full authoritative slot engine without recursive suggestions. Globally unbookable doctors fail immediately and are never suggested.

## Workflow

Allowed dedicated operations are:

- `PENDING -> CONFIRMED`
- `PENDING | CONFIRMED -> CANCELLED`
- `PENDING | CONFIRMED -> RESCHEDULED` while creating a linked replacement atomically
- `CONFIRMED -> CHECKED_IN`
- `CONFIRMED -> NO_SHOW`
- `CHECKED_IN -> IN_PROGRESS`
- `IN_PROGRESS -> COMPLETED`

There is no generic status-write endpoint. Patient cancel/reschedule obeys the cancellation window; patient reschedule also requires `allow_reschedule`. Doctor/Admin operations are not subject to the customer window. Patient booking starts confirmed only when `accept_auto_booking` is true. Admin creation may explicitly choose pending or confirmed and is limited to `admin_panel` or `phone` sources.

Appointment mutations and availability mutations write domain history or operational `ActivityLog` as applicable. After a transaction commits, workflow events create deduplicated immediate notification records and dispatch them through the existing notification service: creation targets Patient and Doctor, confirmation/completion/no-show target Patient, cancellation targets the opposite party, and rescheduling targets Patient and Doctor. Provider failures do not roll back the appointment. There is no durable scheduler in this repository, so appointment reminders remain explicitly `DURABLE_APPOINTMENT_REMINDERS_PENDING`; no in-memory timer was added.

## API routes

All routes are mounted under `/api` and use the existing audience/role guards.

Patient Mobile (`/mobile/appointments`): `GET /availability`, `GET /`, `POST /`, `GET /:id`, `GET /:id/history`, `POST /:id/cancel`, and `POST /:id/reschedule`.

Doctor Dashboard (`/dash/doctor/appointments`): weekly availability GET/PUT, exception GET/POST/PATCH/DELETE, preview, settings PATCH, calendar/list/detail/history, and dedicated confirm/check-in/start/complete/no-show/cancel/reschedule/internal-notes operations. Each request resolves the authenticated doctor; no doctor ID can override ownership.

Admin Dashboard (`/dash/admin/appointments`): global doctor availability operations, preview, settings, calendar/list/detail/history, assisted creation, all workflow operations, notes, and payment status.

Permission mapping:

- `manage_appointments`: list/create/workflow/history/notes
- `manage_availability`: schedules, exceptions, preview and settings
- `manage_payments`: payment status
- Super Admin uses the existing bypass.

## Indexes and transactions

Appointment indexes support unique display number; doctor/start; doctor/status/start; clinic/start; patient/start; status/start; doctor/local-date/status capacity counts; and doctor/local-date/blocked interval scans. Availability is unique by doctor/clinic/day. Exceptions are unique by doctor/clinic/date. History is ordered by appointment/created time.

Creation atomically covers day lock, fresh slot check, counter, appointment and history. State changes atomically cover compare-and-set version plus history. Rescheduling creates and links both records in one transaction. Startup rejects Mongo deployments without replica-set/mongos transaction support and discards only old-shape appointment records before reconciling indexes.
