# Children

All routes require a Patient Mobile token. Ownership is always scoped to the authenticated Patient; another Patient's child is returned as `404`, avoiding identity leakage.

| Method and path | Body/query | Success |
|---|---|---|
| `GET /children` | `include_inactive?: boolean` | `200` array |
| `POST /children` | child create body | `201` child |
| `GET /children/:childId` | — | `200` child |
| `PATCH /children/:childId` | partial create body | `200` child |
| `PATCH /children/:childId/status` | `{status}` | `200` child |
| `GET /children/:childId/health-profile` | — | `200` child health |
| `PATCH /children/:childId/health-profile` | health MVP body | `200` child health |

Create body (`photo` is intentionally not accepted):

```json
{"full_name":"زينب علي","date_of_birth":"2018-04-20","gender":"female","relationship":"daughter"}
```

Child DTO fields are `_id`, `full_name`, `date_of_birth`, derived `age`, `gender`, `relationship`, nullable `photo`, `status`, `createdAt`, and `updatedAt`. Status values are `active` and `inactive`; status is changed only through the status endpoint. Relationships: `son`, `daughter`, `brother`, `sister`, `grandson`, `granddaughter`, `other`.

```bash
curl -X POST '{{baseUrl}}/mobile/children' -H 'Authorization: Bearer {{accessToken}}' -H 'Content-Type: application/json' -d '{"full_name":"زينب علي","date_of_birth":"2018-04-20","gender":"female","relationship":"daughter"}'
```

Child health has the same Patient-managed fields as the main health profile: `blood_type`, `allergies`, and `chronic_condition_ids`; the response expands `chronic_conditions` and includes DOB/age. An inactive child remains readable when explicitly requested but cannot be used for new Appointment, Home Care, or Pharmacy requests.

Photo flow: `POST /children` without `photo` → read the returned child `_id` → create and complete an upload using purpose `PATIENT_CHILD_PHOTO` and that child ID as `targetId` → `PATCH /children/:childId` with `{ "photo": "<ready public reference>" }`. PATCH also accepts `photo: null` to clear the current image. Upload ownership, purpose, readiness, and target checks remain authoritative.

Common failure: `400` invalid ID/date, `404` missing or not owned, `422` validation/inactive beneficiary. Arabic: لا تعتمد `relationship` كصلاحية؛ ملكية السجل في الخادم هي المرجع.
