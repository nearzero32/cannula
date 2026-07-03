# Kanona Project Documentation

## Overview

Kanona is a doctor appointment booking platform that connects patients, doctors, clinics, and admins in one system.

The REST API is built with [Elysia](https://elysiajs.com/) on the **Bun** runtime, backed by **MongoDB** (Mongoose) and **Redis**.

This MVP focuses on:

- user authentication
- patient profiles
- doctor profiles
- admin profiles
- clinics
- specialties
- appointments
- push/in-app notifications
- activity logging
- ads and about-us content

Future phases can extend with:

- reviews and ratings
- video consultations
- medical records
- payments
- doctor verification documents
- availability exceptions and leave management
- queue system

## Tech Stack

| Layer              | Technology                    |
| ------------------ | ----------------------------- |
| Runtime            | Bun                           |
| HTTP framework     | Elysia                        |
| Database           | MongoDB (Mongoose)            |
| Cache / sessions   | Redis                         |
| Push notifications | OneSignal                     |
| API docs           | Swagger (`@elysiajs/swagger`) |

### Request Lifecycle

```text
HTTP Request → Elysia router → AuthPlugin → Controller → Service → Mongoose → MongoDB
                                      ↕
                               Redis (access/refresh sessions)
```

Protected routes require a Bearer JWT. The middleware verifies the token signature, then checks the SHA-256 hash in Redis. Access sessions expire after 15 minutes; refresh tokens last 7 days.

### API Conventions

- All controller `message` strings are in **Arabic**.
- No hard deletes — entities are deactivated via `PATCH /:id/status`.
- Paginated list endpoints return:

```ts
{
    error: false,
    message: '...',
    data: [...],
    pagination: { page, limit, total, pages, hasNext, hasPrev }
}
```

## Main Roles

### Patient

Patients are public app users and can:

- register and log in
- browse doctors and clinics
- search by specialty
- book appointments
- view appointment history
- reschedule or cancel appointments (if allowed)

### Doctor

Doctors are managed accounts (created/approved by admins) and can:

- maintain a professional profile
- be linked to one or more clinics
- configure booking defaults
- receive and manage appointments
- manage secretary accounts

### Admin

Admins manage the platform and can:

- create/manage doctors
- create/manage clinics
- create/manage specialties
- manage patient and appointment records
- send and manage notifications
- activate/suspend/update entities
- view activity logs

## Architecture

The system is split into focused collections to keep responsibilities clear.

Main models:

- `users`
- `admins`
- `patients`
- `doctors`
- `clinics`
- `specialties`
- `appointments`
- `notifications`
- `activity_logs`
- `ads`
- `about_us`
- `secretaries`

## Model Summaries

### Users

Purpose: base authentication and identity layer.

```ts
type User = {
  _id: string;
  full_name: string;
  email?: string;
  phone: string;
  passwordHash: string;
  role: "admin" | "doctor" | "patient";
  status: "pending" | "active" | "inactive" | "suspended";
  is_phone_verified: boolean;
  is_email_verified: boolean;
  last_login_at?: Date;
  createdAt: Date;
  updatedAt: Date;
};
```

Notes:

- public signup should default to `patient`
- doctor/admin accounts should be created or approved internally
- role-specific profile data should be stored outside `users`

### Admins

Purpose: administrative identity and permissions.

```ts
type Admin = {
  _id: string;
  user_id: string;
  display_name: string;
  job_title?: string;
  permissions: string[];
  superAdmin: boolean;
  is_active: boolean;
  created_by?: string;
  last_action_at?: Date;
  createdAt: Date;
  updatedAt: Date;
};
```

Suggested permissions:

- `manage_users`
- `manage_doctors`
- `manage_patients`
- `manage_appointments`
- `manage_clinics`
- `manage_specialties`
- `verify_doctors`
- `manage_settings`
- `view_reports`

### Patients

Purpose: patient profile data separate from login.

```ts
type Patient = {
  _id: string;
  user_id: string;
  full_name: string;
  gender?: "male" | "female";
  date_of_birth?: Date;
  phone?: string;
  address?: string;
  profile_photo?: string;
  blood_group?: "A+" | "A-" | "B+" | "B-" | "AB+" | "AB-" | "O+" | "O-";
  status: "active" | "inactive" | "blocked";
  notes_internal?: string;
  createdAt: Date;
  updatedAt: Date;
};
```

### Doctors

Purpose: doctor professional profile and booking defaults.

```ts
type Doctor = {
  _id: string;
  user_id: string;
  full_name: string;
  display_name: string;
  gender?: "male" | "female";
  profile_photo?: string;
  bio?: string;
  specialty: string;
  sub_specialties?: string[];
  languages?: string[];
  experience_years?: number;
  license_number?: string;
  license_verified: boolean;
  verification_status: "pending" | "verified" | "rejected";
    clinic_ids?: string[];
    map_location?: { lat: number; lng: number };
  appointment_duration: number;
  slot_interval: number;
  buffer_before?: number;
  buffer_after?: number;
  accept_auto_booking: boolean;
  allow_reschedule: boolean;
  booking_lead_time_hours?: number;
  cancellation_window_hours?: number;
  consultation_fee?: number;
  follow_up_fee?: number;
  currency?: string;
  assistant_ids?: string[];
  accepting_new_patients?: boolean;
  is_featured?: boolean;
  status: "draft" | "active" | "inactive" | "suspended";
  notes_internal?: string;
  createdAt: Date;
  updatedAt: Date;
};
```

Notes:

- `specialty` is currently stored as a string (specialty name). Prefer linking to the `specialties` collection in a future refactor.
- Not included yet: ratings/reviews, video modes, home visits.

### Clinics

Purpose: physical clinic/location data.

```ts
type Clinic = {
  _id: string;
  name: string;
  description?: string;
  address: string;
  icon?: string;
  map_location?: { lat?: number; lng?: number };
  status: "active" | "inactive" | "suspended";
  created_by?: string;
  createdAt: Date;
  updatedAt: Date;
};
```

Notes:

- detailed doctor availability should remain separate from clinic location data

### Specialties

Purpose: normalized specialty catalog.

```ts
type Specialty = {
  _id: string;
  name: string;
  description?: string;
  icon?: string;
  status: "active" | "inactive";
  sortOrder?: number;
  created_by?: string;
  createdAt: Date;
  updatedAt: Date;
};
```

### Appointments

Purpose: booking transaction linking patient, doctor, clinic, and time.

```ts
type Appointment = {
  _id: string;
  appointment_number: string;
  patient_id: string;
  doctor_id: string;
  clinic_id: string;
  specialty_id?: string;
  date: Date;
  start_time: string;
  end_time: string;
  status:
    | "pending"
    | "confirmed"
    | "checked_in"
    | "in_progress"
    | "cancelled"
    | "completed"
    | "no_show"
    | "rescheduled";
  booked_by?: string;
  booking_source: "app" | "admin_panel" | "phone";
  reason?: string;
  notes_internal?: string;
  cancel_reason?: string;
  cancelled_by?: string;
  cancelled_by_model?: "Patient" | "Doctor" | "User";
  cancelled_at?: Date;
  rescheduled_from?: string;
  rescheduled_to?: string;
  payment_status: "unpaid" | "paid" | "refunded" | "partial";
  checked_in_at?: Date;
  completed_at?: Date;
  appointment_fee: number;
  createdAt: Date;
  updatedAt: Date;
};
```

Recommended status flow:

- `pending` → `confirmed` → `checked_in` → `in_progress` → `completed`
- `pending` / `confirmed` → `cancelled` or `no_show`
- `confirmed` → `rescheduled`

Important anti-double-booking rule:

- unique compound index on `doctor_id + date + start_time`

### Notifications

Purpose: in-app and push notification records for patients and doctors.

```ts
type Notification = {
  _id: string;
  recipient_ids: string[];
  recipient_model: "Patient" | "Doctor" | "User";
  type:
    | "appointment_booked"
    | "appointment_confirmed"
    | "appointment_cancelled"
    | "appointment_reminder"
    | "appointment_completed"
    | "appointment_no_show"
    | "appointment_rescheduled"
    | "general";
  status: "pending" | "scheduled" | "sent" | "failed" | "cancelled";
  title: string;
  body: string;
  data?: Record<string, unknown>;
  is_read: boolean;
  read_at?: Date;
  scheduled_at?: Date;
  sent_at?: Date;
  failed_reason?: string;
  appointment_id?: string;
  createdAt: Date;
  updatedAt: Date;
};
```

Push delivery uses **OneSignal** (`ONESIGNAL_APP_ID`, `ONESIGNAL_API_KEY` env vars).

### Activity Logs

Purpose: audit trail for dashboard write operations. Auto-expires after 90 days.

```ts
type ActivityLog = {
  _id: string;
  user_id: string;
  user_name: string;
  user_type: string;
  method: string;
  endpoint: string;
  action: "create" | "update" | "delete" | "status_change";
  collection_name: string;
  document_id?: string;
  old_data?: Record<string, unknown>;
  new_data?: Record<string, unknown>;
  changed_fields?: string[];
  request_body?: Record<string, unknown>;
  source: "dashboard" | "mobile" | "system";
  createdAt: Date;
  updatedAt: Date;
};
```

### Ads

Purpose: promotional banners shown in the mobile app.

```ts
type Ads = {
  _id: string;
  title?: string;
  description?: string;
  image: string;
  link?: string;
  clinic_id?: string;
  doctor_id?: string;
  status: "active" | "inactive";
  end_date?: Date;
  createdAt: Date;
  updatedAt: Date;
};
```

### About Us

Purpose: singleton platform info (name, logo, contact, social links).

```ts
type AboutUs = {
  _id: string;
  name: string;
  logo: string;
  description?: string;
  address?: string;
  phone?: string;
  website?: string;
  facebook?: string;
  instagram?: string;
  createdAt: Date;
  updatedAt: Date;
};
```

### Secretaries

Purpose: clinic staff accounts managed by doctors with granular permissions.

```ts
type Secretary = {
  _id: string;
  user_id: string;
  full_name: string;
  clinic_id?: string;
  doctor_ids: string[];
  permissions: string[];
  status: "active" | "inactive" | "suspended";
  createdAt: Date;
  updatedAt: Date;
};
```

## Relationships

Core relationships:

- one `User` can have one `Patient`
- one `User` can have one `Doctor`
- one `User` can have one `Admin`
- one `Doctor` can belong to one or more `Clinic`
- one `Doctor` references a `Specialty` (currently by name string)
- one `Appointment` belongs to one `Patient`, one `Doctor`, and one `Clinic`
- one `Notification` belongs to one recipient (`Patient`, `Doctor`, or `User`)
- one `Secretary` belongs to one `User` and is linked to one or more `Doctor`

Simple ER-style view:

```text
User
├── Patient ─── Notification
├── Doctor ─── Notification
│   └── Secretary
└── Admin

Doctor ─── Specialty (by name)
Doctor ─── Clinic
Patient ─── Appointment
Doctor ─── Appointment
Clinic ─── Appointment
Specialty ─── Appointment
```

## API Routes

Base URL: `http://localhost:3000`

### Dashboard Auth — `/dash/auth`

Full authentication, token, and refresh-token documentation: [`auth.docs.md`](./auth.docs.md).

| Method | Path       | Auth | Description          |
| ------ | ---------- | ---- | -------------------- |
| POST   | `/login`   | No   | Admin/doctor login   |
| POST   | `/refresh` | No   | Refresh access token |
| POST   | `/logout`  | Yes  | Revoke session       |

### Admin — `/dash/admin`

All routes require authentication.

#### Clinics — `/clinics`

| Method | Path          | Description              |
| ------ | ------------- | ------------------------ |
| GET    | `/`           | List clinics (paginated) |
| GET    | `/:id`        | Get clinic by ID         |
| POST   | `/`           | Create clinic            |
| PUT    | `/:id`        | Update clinic            |
| PATCH  | `/:id/status` | Update clinic status     |

#### Specialties — `/specialties`

| Method | Path          | Description                  |
| ------ | ------------- | ---------------------------- |
| GET    | `/`           | List specialties (paginated) |
| GET    | `/:id`        | Get specialty by ID          |
| POST   | `/`           | Create specialty             |
| PUT    | `/:id`        | Update specialty             |
| PATCH  | `/:id/status` | Update specialty status      |

#### Doctors — `/doctors`

| Method | Path                | Description                                                                                  |
| ------ | ------------------- | -------------------------------------------------------------------------------------------- |
| GET    | `/`                 | List doctors (paginated; filters: status, verification_status, specialty, clinic_id, search) |
| GET    | `/:id`              | Get doctor by ID                                                                             |
| POST   | `/`                 | Create doctor profile                                                                        |
| PUT    | `/:id`              | Update doctor                                                                                |
| PATCH  | `/:id/status`       | Update doctor status                                                                         |
| PATCH  | `/:id/verification` | Update verification status and license flag                                                  |

#### Patients — `/patients`

| Method | Path          | Description               |
| ------ | ------------- | ------------------------- |
| GET    | `/`           | List patients (paginated) |
| GET    | `/:id`        | Get patient by ID         |
| POST   | `/`           | Create patient profile    |
| PATCH  | `/:id/status` | Update patient status     |

#### Appointments — `/appointments`

| Method | Path            | Description                   |
| ------ | --------------- | ----------------------------- |
| GET    | `/`             | List appointments (paginated) |
| GET    | `/:id`          | Get appointment by ID         |
| POST   | `/`             | Create appointment            |
| PATCH  | `/:id/status`   | Update status                 |
| PATCH  | `/:id/notes`    | Update internal notes         |
| PATCH  | `/:id/cancel`   | Cancel appointment            |
| PATCH  | `/:id/check-in` | Check in patient              |
| PATCH  | `/:id/complete` | Complete appointment          |
| PATCH  | `/:id/no-show`  | Mark no-show                  |
| PATCH  | `/:id/payment`  | Update payment status         |

#### Notifications — `/notifications`

| Method | Path          | Description                           |
| ------ | ------------- | ------------------------------------- |
| GET    | `/`           | List notifications (paginated)        |
| GET    | `/:id`        | Get notification by ID                |
| POST   | `/`           | Send/create notification              |
| PATCH  | `/:id/cancel` | Cancel pending/scheduled notification |

#### Ads — `/ads`

| Method | Path          | Description          |
| ------ | ------------- | -------------------- |
| GET    | `/`           | List ads (paginated) |
| GET    | `/:id`        | Get ad by ID         |
| POST   | `/`           | Create ad            |
| PUT    | `/:id`        | Update ad            |
| PATCH  | `/:id/status` | Update ad status     |

#### About Us — `/about-us`

| Method | Path | Description          |
| ------ | ---- | -------------------- |
| GET    | `/`  | Get platform info    |
| PATCH  | `/`  | Update platform info |

#### Activity Logs — `/activity-logs`

| Method | Path   | Description                    |
| ------ | ------ | ------------------------------ |
| GET    | `/`    | List activity logs (paginated) |
| GET    | `/:id` | Get log entry by ID            |

### Doctor Dashboard — `/dash/doctor`

All routes require authentication.

#### Profile — `/profile`

| Method | Path | Description            |
| ------ | ---- | ---------------------- |
| GET    | `/`  | Get own doctor profile |
| PATCH  | `/`  | Update own profile     |

#### Appointments — `/appointments`

| Method | Path            | Description                       |
| ------ | --------------- | --------------------------------- |
| GET    | `/`             | List own appointments (paginated) |
| GET    | `/:id`          | Get appointment by ID             |
| PATCH  | `/:id/cancel`   | Cancel appointment                |
| PATCH  | `/:id/check-in` | Check in patient                  |
| PATCH  | `/:id/complete` | Complete appointment              |
| PATCH  | `/:id/no-show`  | Mark no-show                      |
| PATCH  | `/:id/notes`    | Update internal notes             |

#### Secretaries — `/secretaries`

| Method | Path          | Description                  |
| ------ | ------------- | ---------------------------- |
| GET    | `/`           | List secretaries (paginated) |
| GET    | `/:id`        | Get secretary by ID          |
| POST   | `/`           | Create secretary             |
| PATCH  | `/:id`        | Update secretary             |
| PATCH  | `/:id/status` | Update secretary status      |

#### Activity Logs — `/activity-logs`

| Method | Path   | Description                        |
| ------ | ------ | ---------------------------------- |
| GET    | `/`    | List own activity logs (paginated) |
| GET    | `/:id` | Get log entry by ID                |

### Mobile — `/mobile`

Public routes (no auth required).

| Method | Path        | Description       |
| ------ | ----------- | ----------------- |
| GET    | `/about-us` | Get platform info |
| GET    | `/ads`      | List active ads   |

## Booking Flows

### Patient Booking Flow

1. Patient registers in the app.
2. System creates `User` with role `patient`.
3. System creates related `Patient` profile.
4. Patient browses specialties and doctors.
5. Patient selects clinic and time.
6. System creates `Appointment`.
7. System sends notification to patient and doctor.

### Admin Doctor Creation Flow

1. Admin creates user account for doctor.
2. System creates `User` with role `doctor`.
3. Admin creates related `Doctor` profile via `POST /dash/admin/doctors`.
4. Admin links doctor to specialty and clinic(s).
5. Admin verifies doctor via `PATCH /dash/admin/doctors/:id/verification`.
6. Doctor becomes bookable when status is `active`.

## MVP Scope

Included in MVP:

- authentication (dashboard login/refresh/logout)
- roles (admin, doctor, patient)
- patient profiles
- doctor profiles (admin CRUD + doctor self-service profile)
- clinic management
- specialty management
- appointment creation and full status workflow
- admin management
- push/in-app notifications (OneSignal)
- activity logging
- ads and about-us content
- doctor secretary management

Excluded for now:

- ratings and reviews
- online video consultation
- payments processing
- medical records
- prescription module
- lab/imaging requests
- queue system
- availability exceptions
- doctor verification document uploads
- patient mobile auth and booking endpoints

## Suggested Future Collections

- `doctor_availability`
- `doctor_documents`
- `reviews`
- `payments`
- `medical_records`
- `prescriptions`

## Recommended Development Order

1. `users`
2. `admins`
3. `specialties`
4. `clinics`
5. `doctors`
6. `patients`
7. `appointments`
8. `notifications`
9. `activity_logs`
10. `ads` / `about_us`
11. `secretaries`

After stabilization:

- `doctor_availability`
- patient mobile auth and booking
- `payments`
- `medical_records`

## Environment Variables

Required in `.env`:

```env
# Auth
ACCESS_TOKEN_SECRET=
REFRESH_TOKEN_SECRET=

# MongoDB
MONGODB_URI=mongodb://localhost:27017/cannula

# Redis
REDIS_HOST=
REDIS_PORT=6379

# Push notifications
ONESIGNAL_APP_ID=
ONESIGNAL_API_KEY=
```

## Final Notes

This architecture is suitable for MVP delivery because it cleanly separates:

- authentication (`users`)
- role profiles (`patients`, `doctors`, `admins`)
- locations (`clinics`)
- classification (`specialties`)
- booking transactions (`appointments`)
- communication (`notifications`)
- audit trail (`activity_logs`)

Keeping each model focused makes the system easier to maintain, scale, and extend.
