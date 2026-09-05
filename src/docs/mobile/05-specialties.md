# Specialties

Public routes:

- `GET /mobile/specialties?page=1&limit=10&search=قلب` (limit max 100)
- `GET /mobile/specialties/:id`

Only active specialties are visible. List order is `sort_order`, then `_id`; preserve the returned order. Mobile DTO deliberately exposes only `_id`, `name`, nullable `description`, and nullable `icon`; it does not expose `sort_order` or status.

```bash
curl '{{baseUrl}}/mobile/specialties?page=1&limit=10'
```

```json
{"error":false,"message":"تم جلب التخصصات بنجاح","data":[{"_id":"66f000000000000000000010","name":"طب القلب","description":"رعاية القلب والأوعية","icon":null}],"pagination":{"page":1,"limit":10,"total":1,"pages":1,"hasNext":false,"hasPrev":false}}
```

Use `_id` as `specialty_id` in Doctor filters and `specialtyId` in availability/booking. Invalid detail IDs return `400`; inactive/missing records return `404`. The list cache TTL is 300 seconds.

Arabic: اعرض ترتيب الخادم كما هو، واستعمل صورة بديلة عندما تكون `icon: null`.

