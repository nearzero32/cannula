# Optional Flutter Model Mapping

This is client guidance, not a backend requirement. Map Mongo ObjectIds and UUID references to `String`; ISO instants to `DateTime`; `YYYY-MM-DD` business dates to a date-only value/string; preserve nullable fields; use enum wire values exactly and retain an `unknown` fallback in resilient decoders. Model `pagination` once. Notification target is a nullable tagged union on `type`.

```dart
class Doctor {
  final String id, displayName;
  final String? profilePhoto, gender, currency;
  final int? experienceYears, consultationFee, followUpFee;
  final bool isFeatured, acceptingNewPatients, isVerified;
  Doctor.fromJson(Map<String,dynamic> j)
    : id=j['_id'], displayName=j['display_name'], profilePhoto=j['profile_photo'],
      gender=j['gender'], currency=j['currency'], experienceYears=j['experience_years'],
      consultationFee=j['consultation_fee'], followUpFee=j['follow_up_fee'],
      isFeatured=j['is_featured'], acceptingNewPatients=j['accepting_new_patients'],
      isVerified=j['is_verified'];
}

class Appointment {
  final String id, status, localDate, localStartsAt, timezone;
  final DateTime startsAt, endsAt;
  final bool canCancel, canReschedule;
  Appointment.fromJson(Map<String,dynamic> j)
    : id=j['_id'], status=j['status'], localDate=j['localDate'],
      localStartsAt=j['localStartsAt'], timezone=j['timezone'],
      startsAt=DateTime.parse(j['startsAt']), endsAt=DateTime.parse(j['endsAt']),
      canCancel=j['capabilities']?['canCancel'] ?? false,
      canReschedule=j['capabilities']?['canReschedule'] ?? false;
}

class NotificationTarget { final String type, id; NotificationTarget.fromJson(Map<String,dynamic> j): type=j['type'], id=j['id']; }
class MobileNotification {
  final String id, category, type, title, body, privacy;
  final DateTime createdAt; final bool isRead; final NotificationTarget? target;
  MobileNotification.fromJson(Map<String,dynamic> j)
    : id=j['_id'], category=j['category'], type=j['type'], title=j['title'], body=j['body'],
      privacy=j['privacy'], createdAt=DateTime.parse(j['createdAt']), isRead=j['is_read'],
      target=j['target']==null ? null : NotificationTarget.fromJson(j['target']);
}
```

Recommended service grouping: `AuthApi`, `ProfileApi`, `DoctorsApi`, `AppointmentsApi`, `HomeCareApi`, `PharmacyApi`, `NotificationsApi`, and `UploadsApi`. Add `ReferenceApi` for Ads, About Us, Specialties, chronic conditions, and suggestions. Keep refresh coordination in one transport layer; domain services should receive already-decoded envelopes.

Arabic: لا تحوّل القيم غير المعروفة إلى حالة خاطئة؛ احتفظ بحالة fallback لتوافق الإصدارات.

