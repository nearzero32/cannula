# My Medications / أدويتي

All routes require a Mobile access token for a Patient. Ownership is derived from the authenticated User's Patient profile; never send or store a client-provided `patient_id`.

## Medication CRUD

- `GET /mobile/medications` lists active owned medications.
- `POST /mobile/medications` creates one.
- `GET /mobile/medications/:id` reads one owned active medication.
- `PATCH /mobile/medications/:id` edits medication or schedule fields.
- `DELETE /mobile/medications/:id` archives rather than deleting history.

```json
{
  "name": "دواء موصوف",
  "strength_text": "500 mg",
  "dose_instructions": "1 tablet",
  "notes": null,
  "schedule": {
    "timezone": "Asia/Baghdad",
    "weekdays": [0, 1, 2, 3, 4, 5, 6],
    "times": ["08:00", "20:00"],
    "start_date": "2026-09-07",
    "end_date": null
  },
  "reminders_enabled": true
}
```

`weekdays` uses Sunday `0` through Saturday `6`; all seven values mean daily. Times are unique `HH:mm` local wall times, with at most eight per day. The default timezone is `Asia/Baghdad`, but any valid IANA timezone is accepted. `start_date` and `end_date` are local calendar dates; stored dose instants are UTC. Text such as `1 tablet` or `5 ml` is patient-entered and is never inferred or medically calculated by the backend.

Every response includes `schedule_version`. A schedule, timezone, date range, weekday/time, or `reminders_enabled` change increments it. A name/instruction edit alone does not. After mutation or app foregrounding, compare server versions to locally stored versions, cancel local notifications for missing/older versions, and schedule the returned current occurrences.

## Local Notification sync

Call `GET /mobile/medication-reminders/upcoming`. It returns `generated_at`, `window_ends_at`, a `schedules` version manifest, and seven days of `reminders`:

```json
{
  "dose_id": "66f000000000000000000091",
  "medication_id": "66f000000000000000000090",
  "scheduled_at": "2026-09-08T05:00:00.000Z",
  "timezone": "Asia/Baghdad",
  "schedule_version": 3,
  "title": "تذكير بموعد الدواء",
  "body": "لديك موعد دواء مسجل"
}
```

The mobile application owns timed delivery and schedules these as Local Notifications. The backend notification is in-app only: it creates `Notification` and `NotificationRecipient`, never `NotificationDelivery`, and never calls OneSignal.

Generation is rolling, persistent, concurrency-safe, and idempotent. The server generates only future instants in the next seven days. A unique `(medication_id, schedule_version, scheduled_at)` index prevents duplicate doses. Schedule changes mark only future PENDING old-version doses `CANCELLED`; past history remains.

## Today and recording

- `GET /mobile/medication-doses/today` uses Baghdad midnight boundaries.
- `PATCH /mobile/medication-doses/:id/taken` records `TAKEN`, `taken_at`, and `recorded_at` using server time.
- `PATCH /mobile/medication-doses/:id/not-taken` records `NOT_TAKEN` and `recorded_at`.

Both writes are idempotent when repeated with the same final state. Only `PENDING` can transition to a final state; attempting `TAKEN → NOT_TAKEN` or the reverse returns `409`. Ignoring a reminder does not automatically mean not taken.

## Inbox handling

The generated notification is `category: medications`, `type: medication_reminder`, `privacy: sensitive`, with `source.domain: patient_medication` and `target.type: medication_dose`. Its `visible_at` equals the dose's `scheduled_at`, so it is not returned early.

```dart
case 'medication_dose':
  openMedicationDose(notification.target.id);
```

Notification `read/unread` and dose `PENDING/TAKEN/NOT_TAKEN` are independent. Opening or marking the notification read never records a dose.
