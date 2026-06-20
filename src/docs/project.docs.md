# Kanona Project Documentation

## Overview

Kanona is a doctor appointment booking platform that connects patients, doctors, clinics, and admins in one system.

This MVP focuses on:

- user authentication
- patient profiles
- doctor profiles
- admin profiles
- clinics
- specialties
- appointments

Future phases can extend with:

- reviews and ratings
- video consultations
- medical records
- notifications
- payments
- doctor verification documents
- availability exceptions and leave management

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

### Admin

Admins manage the platform and can:

- create/manage doctors
- create/manage clinics
- create/manage specialties
- manage patient and appointment records
- activate/suspend/update entities

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
    role: 'admin' | 'doctor' | 'patient';
    status: 'pending' | 'active' | 'inactive' | 'suspended';
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
    gender?: 'male' | 'female';
    date_of_birth?: Date;
    phone?: string;
    address?: string;
    profile_photo?: string;
    blood_group?: 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-';
    allergies?: string[];
    chronic_conditions?: string[];
    emergency_contact_name?: string;
    emergency_contact_phone?: string;
    status: 'active' | 'inactive' | 'blocked';
    notes_internal?: string;
    createdAt: Date;
    updatedAt: Date;
};
```

MVP recommendation: start with core fields (`user_id`, `full_name`, `gender`, `date_of_birth`, `phone`, `status`) and add richer medical profile fields as needed.

### Doctors

Purpose: doctor professional profile and booking defaults.

```ts
type Doctor = {
    _id: string;
    user_id: string;
    full_name: string;
    display_name: string;
    gender?: 'male' | 'female';
    profile_photo?: string;
    bio?: string;
    specialty_id?: string;
    sub_specialties?: string[];
    languages?: string[];
    experience_years?: number;
    license_number?: string;
    license_verified: boolean;
    verification_status: 'pending' | 'verified' | 'rejected';
    clinic_ids?: string[];
    clinicLocation?: string;
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
    status: 'draft' | 'active' | 'inactive' | 'suspended';
    notes_internal?: string;
    createdAt: Date;
    updatedAt: Date;
};
```

Not included yet: ratings/reviews, video modes, home visits.

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
    working_days?: { day: number; enabled: boolean; from?: string; to?: string }[];
    status: 'active' | 'inactive' | 'suspended';
    created_by?: string;
    notes_internal?: string;
    createdAt: Date;
    updatedAt: Date;
};
```

Notes:

- clinic working days represent clinic-level hours
- detailed doctor availability should remain separate

### Specialties

Purpose: normalized specialty catalog.

```ts
type Specialty = {
    _id: string;
    name: string;
    description?: string;
    icon?: string;
    status: 'active' | 'inactive';
    sortOrder?: number;
    created_by?: string;
    createdAt: Date;
    updatedAt: Date;
};
```

Doctors should reference specialty entries instead of free-text values.

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
    status: 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show';
    booked_by?: string;
    booking_source?: 'app' | 'admin_panel' | 'phone';
    reason?: string;
    notes_internal?: string;
    cancel_reason?: string;
    rescheduled_from?: string;
    createdAt: Date;
    updatedAt: Date;
};
```

Recommended status flow:

- `pending`
- `confirmed`
- `cancelled`
- `completed`
- `no_show`

Important anti-double-booking rule:

- add a unique compound constraint on `doctor_id + date + start_time`

## Relationships

Core relationships:

- one `User` can have one `Patient`
- one `User` can have one `Doctor`
- one `User` can have one `Admin`
- one `Doctor` can belong to one or more `Clinic`
- one `Doctor` belongs to one `Specialty`
- one `Appointment` belongs to one `Patient`
- one `Appointment` belongs to one `Doctor`
- one `Appointment` belongs to one `Clinic`
- one `Appointment` can optionally reference one `Specialty`

Simple ER-style view:

```text
User
├── Patient
├── Doctor
└── Admin

Doctor ─── Specialty
Doctor ─── Clinic
Patient ─── Appointment
Doctor ─── Appointment
Clinic ─── Appointment
Specialty ─── Appointment
```

## Booking Flows

### Patient Booking Flow

1. Patient registers in the app.
2. System creates `User` with role `patient`.
3. System creates related `Patient` profile.
4. Patient browses specialties and doctors.
5. Patient selects clinic and time.
6. System creates `Appointment`.

### Admin Doctor Creation Flow

1. Admin creates user account for doctor.
2. System creates `User` with role `doctor`.
3. Admin creates related `Doctor` profile.
4. Admin links doctor to specialty and clinic.
5. Doctor becomes bookable when status is `active`.

## MVP Scope

Included in MVP:

- authentication
- roles
- patient profiles
- doctor profiles
- clinic management
- specialty management
- appointment creation
- appointment status workflow
- admin management

Excluded for now:

- ratings and reviews
- online video consultation
- payments
- notifications
- medical records
- prescription module
- lab/imaging requests
- queue system
- availability exceptions
- doctor verification documents

## Suggested Future Collections

- `doctor_availability`
- `doctor_documents`
- `reviews`
- `notifications`
- `payments`
- `medical_records`
- `prescriptions`
- `audit_logs`

## Recommended Development Order

1. `users`
2. `admins`
3. `specialties`
4. `clinics`
5. `doctors`
6. `patients`
7. `appointments`

After stabilization:

- `doctor_availability`
- `notifications`
- `payments`
- `medical_records`

## Final Notes

This architecture is suitable for MVP delivery because it cleanly separates:

- authentication (`users`)
- role profiles (`patients`, `doctors`, `admins`)
- locations (`clinics`)
- classification (`specialties`)
- booking transactions (`appointments`)

Keeping each model focused makes the system easier to maintain, scale, and extend.
