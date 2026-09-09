# Home Care Availability — Dashboard

Home Care availability is a recurring weekly schedule in the `Asia/Baghdad` business timezone. Each immutable slot identity belongs to one service, one weekday, and one canonical `HH:mm` time. Existing `MANAGE_HOME_CARE` authentication, permission, and Home Care read/manage policy remain unchanged.

The dashboard uses one editor and two endpoints:

- `GET /dash/admin/home-care/services/:serviceId/availability` returns the complete week.
- `PUT /dash/admin/home-care/services/:serviceId/availability` atomically replaces the complete week.

Both responses use:

```json
{
  "service_id": "507f1f77bcf86cd799439011",
  "timezone": "Asia/Baghdad",
  "schedule": [
    { "day_of_week": "SATURDAY", "times": ["09:00", "11:00"] },
    { "day_of_week": "SUNDAY", "times": ["10:00"] },
    { "day_of_week": "MONDAY", "times": [] },
    { "day_of_week": "TUESDAY", "times": [] },
    { "day_of_week": "WEDNESDAY", "times": [] },
    { "day_of_week": "THURSDAY", "times": [] },
    { "day_of_week": "FRIDAY", "times": [] }
  ]
}
```

The PUT body contains the `schedule` field above and must include every weekday exactly once. Each day supports at most 24 unique canonical times. `times: []` means that day is closed; there is no separate enabled flag. The transaction either saves all seven days or saves none of them.

The old dashboard POST/PATCH/DELETE individual-slot routes were removed to prevent overlapping write contracts. UI helpers such as copy-to-day, copy-to-all, clear, and close operate on the editor state and still produce one full-week PUT.

Rows are unique by `(service_id, day_of_week, time)`. Weekly replacement soft-deactivates removed rows and reactivates an existing exact identity when appropriate. Requests continue to snapshot `availability_slot_id` and `preferred_time`; schedule changes never rewrite request history.

Legacy rows without `day_of_week` are detected and reported by the startup migration. They are neither guessed nor copied to weekdays, and they are excluded from new dashboard/mobile schedules. They remain available for historical request references until an operator explicitly classifies or retires them.
