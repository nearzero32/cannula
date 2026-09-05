# Ads and About Us

## Ads

`GET /mobile/ads?page=1&limit=10` is public (limit max 50). It returns only active records inside their optional visibility window, ordered by server `sort_order` then `_id`. DTO fields: `_id`, nullable `title`, nullable `description`, required non-null `image`, nullable ISO `start_date`, nullable ISO `end_date`. No link, Doctor, store, or navigation target exists; Ads are image-only presentation content. `GET /mobile/ads/:id` applies the same visibility rules and returns `400` invalid ID or `404` unavailable.

```json
{"error":false,"message":"تم جلب الإعلانات بنجاح","data":[{"_id":"66f000000000000000000090","title":"خدمات كانيولا","description":null,"image":"https://placehold.co/1200x500.png","start_date":null,"end_date":null}],"pagination":{"page":1,"limit":10,"total":1,"pages":1,"hasNext":false,"hasPrev":false}}
```

Ads are cached for 60 seconds. Preserve returned order. Do not make cards tappable unless the Mobile product adds its own non-backend behavior.

## About Us

`GET /mobile/about-us` is public. Response data is `{name,logo,description,address,phone,website,facebook,instagram}`. `name` and `logo` are required strings in storage; contact/description fields are nullable. Missing configuration returns `404` with `data:null`.

```bash
curl '{{baseUrl}}/mobile/about-us'
```

Arabic: الإعلان صورة فقط في العقد الحالي، ولا يوجد رابط تنقل يعيده الخادم.
