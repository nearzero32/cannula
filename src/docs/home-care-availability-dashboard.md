# Home Care Availability — Dashboard

Availability times are separate `HomeCareAvailabilitySlot` records owned by a Home Care service. Existing `MANAGE_HOME_CARE` authentication, permission, and Home Care read/manage policy apply.

- `GET /dash/admin/home-care/services/:serviceId/availability` lists active and inactive slots.
- `POST /dash/admin/home-care/services/:serviceId/availability` creates one slot.
- `PATCH /dash/admin/home-care/services/:serviceId/availability/:slotId` edits order. Changing `time` atomically deactivates the old slot identity and returns a new or safely reactivated slot identity, preventing a stale mobile selection from silently changing time.
- `PATCH /dash/admin/home-care/services/:serviceId/availability/:slotId/status` activates or deactivates.
- `DELETE /dash/admin/home-care/services/:serviceId/availability/:slotId` is a soft deactivation.
- `PUT /dash/admin/home-care/services/:serviceId/availability` replaces the active list using `{ "times": ["09:00", "11:00"] }`; order becomes 10, 20, etc.

Times are unique per service, canonical `HH:mm`, and limited to 24 per bulk request. Another service may use the same time. Every mutation is activity-logged.

Requests snapshot both `availability_slot_id` and the selected slot's then-current `time` as `preferred_time`. Time identities are immutable; editing or disabling a slot never rewrites historical requests. Availability is not Redis-cached, so dashboard changes are visible immediately.
