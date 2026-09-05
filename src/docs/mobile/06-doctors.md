# Doctors and Availability

All Doctor discovery routes are public.

## List

`GET /mobile/doctors` accepts `page`, `limit` (max 100), `specialty_id`, `clinic_id`, `gender` (`male|female`), `is_featured` (`true|false`), and `search`. Only active, verified, license-verified Doctors are visible. Current ordering is `display_order`, then `_id`; preserve it. Note: `is_featured=true` filters; `false` currently behaves like no filter (recorded as an integration issue).

List DTO: `_id`, `display_name`, nullable `profile_photo`, nullable `gender`, nullable `primary_specialty`, `specialties`, nullable `experience_years`, nullable `consultation_fee`, nullable `follow_up_fee`, nullable `currency`, `is_featured`, `accepting_new_patients`, and constant `is_verified: true`. Specialty objects are `_id`, `name`, nullable `icon`.

```bash
curl '{{baseUrl}}/mobile/doctors?specialty_id={{specialtyId}}&page=1&limit=10'
```

## Available Doctors

`GET /mobile/doctors/available` accepts the same ID/gender/featured filters except search. “Available” means currently bookable: public/verified, accepting new patients, attached to an active clinic, under daily capacity, and possessing an actual server-generated slot for today after booking lead time. Mobile must not calculate this itself.

Each Doctor adds:

```json
{"availability":{"date":"2026-09-05","timezone":"Asia/Baghdad","clinicId":"66f000000000000000000020","nextSlot":{"startsAt":"2026-09-05T08:00:00.000Z","endsAt":"2026-09-05T08:30:00.000Z","localStartsAt":"11:00","localEndsAt":"11:30"},"availableSlotCount":8}}
```

The list is cached for 30 seconds. Refresh after creating/rescheduling a booking.

## Detail and clinics

`GET /mobile/doctors/:id` adds nullable `bio`, `languages`, nullable `map_location`, `appointment_duration`, and `clinics`. Each clinic is `{_id,name,address,icon,map_location:{lat,lng}}`; icon and coordinates may be null. Only active clinics assigned to the Doctor appear.

```bash
curl '{{baseUrl}}/mobile/doctors/{{doctorId}}'
```

```json
{"error":false,"message":"تم جلب الطبيب بنجاح","data":{"_id":"66f000000000000000000030","display_name":"د. علي كريم","profile_photo":null,"gender":"male","primary_specialty":{"_id":"66f000000000000000000010","name":"طب القلب","icon":null},"specialties":[],"experience_years":12,"consultation_fee":35000,"follow_up_fee":20000,"currency":"IQD","is_featured":true,"accepting_new_patients":true,"is_verified":true,"bio":"طبيب تجريبي","languages":["العربية"],"map_location":{"lat":33.3128,"lng":44.3615},"appointment_duration":30,"clinics":[{"_id":"66f000000000000000000020","name":"عيادة تجريبية","address":"بغداد - المنصور","icon":null,"map_location":{"lat":33.3128,"lng":44.3615}}]}}
```

Errors: malformed filter/detail IDs `400`; inactive/missing detail `404`; schema filter errors `422`. Empty `data` is a valid result, not an error. Arabic: لا تعِد ترتيب الأطباء بالاسم أو التقييم ما لم يطلب التصميم ذلك صراحةً.
