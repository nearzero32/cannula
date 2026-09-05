# Suggestions and Reference Data

## Chronic conditions

`GET /mobile/chronic-conditions?page=1&limit=10&search=سكري` is public and returns active conditions with standard pagination (limit max 100), newest first (`createdAt`, descending). Items are current persisted condition documents, including `_id`, `name`, nullable `description`, `status`, and timestamps. Store selected `_id` values in health PATCH requests; the health response itself reduces them to `_id` and `name`.

```bash
curl '{{baseUrl}}/mobile/chronic-conditions'
```

## Suggestions

Both routes require a Patient Mobile token. `GET /mobile/suggestions?page=1&limit=10` returns only the current User's non-deleted suggestions (`_id`, `suggestion`, `createdAt`) with standard pagination, limit max 100. `POST /mobile/suggestions` accepts only `suggestion` (1..2000) and returns `201`. There are no suggestion categories in the current contract.

```bash
curl -X POST '{{baseUrl}}/mobile/suggestions' -H 'Authorization: Bearer {{accessToken}}' -H 'Content-Type: application/json' -d '{"suggestion":"إضافة فلتر للمواعيد الصباحية"}'
```

Arabic: لا تضف تصنيفات من جهة التطبيق؛ أرسل النص كما هو ضمن الحقل `suggestion`.
