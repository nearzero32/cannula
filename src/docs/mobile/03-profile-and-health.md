# Profile and Health

All routes require a Patient Mobile token.

## Profile

`GET /mobile/profile` returns `_id`, `user_id`, `full_name`, `phone`, nullable `gender`, `date_of_birth`, derived `age`, nullable `address`, nullable `profile_photo`, `status`, `profile_completed`, plus `blood_group`, `allergies`, and `chronic_condition_ids`. `profile_completed` is true only when gender and DOB exist.

```bash
curl '{{baseUrl}}/mobile/profile' -H 'Authorization: Bearer {{accessToken}}'
```

```json
{"error":false,"message":"تم جلب الملف الشخصي بنجاح","data":{"_id":"66f000000000000000000001","user_id":"66f000000000000000000002","full_name":"سارة أحمد","phone":"07700000000","gender":"female","date_of_birth":"1994-06-12","age":32,"address":"بغداد - المنصور","profile_photo":null,"status":"active","profile_completed":true,"blood_group":"O+","allergies":["البنسلين"],"chronic_condition_ids":[]}}
```

`PATCH /mobile/profile/complete-profile` accepts only `full_name` (2..120), nullable `email`, nullable `gender`, nullable `date_of_birth` (`YYYY-MM-DD`), nullable `address` (max 300), and nullable `profile_photo`. Additional fields fail validation. `phone`, IDs, status, age, health fields, and ownership fields are server-owned.

```bash
curl -X PATCH '{{baseUrl}}/mobile/profile/complete-profile' -H 'Authorization: Bearer {{accessToken}}' -H 'Content-Type: application/json' \
  -d '{"full_name":"سارة أحمد","gender":"female","date_of_birth":"1994-06-12","address":"بغداد - المنصور"}'
```

The response is the identity DTO and does not include health fields. Refetch `/profile` if the screen needs the merged view. Invalid dates return `400`; missing/not-owned profile returns `404`.

## Health profile MVP

`GET /mobile/profile/health` returns `date_of_birth`, derived `age`, nullable `blood_type`, `allergies`, expanded `chronic_conditions` entries (`_id`, `name`), and `updatedAt`. `PATCH /mobile/profile/health` accepts only:

```json
{"blood_type":"O+","chronic_condition_ids":["66f000000000000000000010"],"allergies":["البنسلين"]}
```

Arrays replace the current values; use `[]` to clear. Allergies are trimmed/de-duplicated case-insensitively (max 50, each max 120). Chronic IDs must reference active catalog entries (max 50). Weight, height, medications, and medical notes exist internally but are not Patient-writable or returned by this Mobile contract.

```bash
curl -X PATCH '{{baseUrl}}/mobile/profile/health' -H 'Authorization: Bearer {{accessToken}}' -H 'Content-Type: application/json' -d '{"blood_type":"O+","allergies":[],"chronic_condition_ids":[]}'
```

Arabic: لا ترسل حقولاً سريرية إضافية؛ واجهة المريض الحالية تدير فصيلة الدم والحساسيات والحالات المزمنة فقط.
