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
    fullName: string;
    email?: string;
    phone: string;
    passwordHash: string;
    role: 'admin' | 'doctor' | 'patient';
    status: 'pending' | 'active' | 'inactive' | 'suspended';
    isPhoneVerified: boolean;
    isEmailVerified: boolean;
    lastLoginAt?: Date;
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
    userId: string;
    displayName: string;
    jobTitle?: string;
    permissions: string[];
    superAdmin: boolean;
    isActive: boolean;
    createdBy?: string;
    lastActionAt?: Date;
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
    userId: string;
    fullName: string;
    gender?: 'male' | 'female';
    dateOfBirth?: Date;
    phone?: string;
    address?: string;
    profilePhoto?: string;
    bloodGroup?: 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-';
    allergies?: string[];
    chronicConditions?: string[];
    emergencyContactName?: string;
    emergencyContactPhone?: string;
    status: 'active' | 'inactive' | 'blocked';
    notesInternal?: string;
    createdAt: Date;
    updatedAt: Date;
};
```

MVP recommendation: start with core fields (`userId`, `fullName`, `gender`, `dateOfBirth`, `phone`, `status`) and add richer medical profile fields as needed.

### Doctors

Purpose: doctor professional profile and booking defaults.

```ts
type Doctor = {
    _id: string;
    userId: string;
    fullName: string;
    displayName: string;
    gender?: 'male' | 'female';
    profilePhoto?: string;
    bio?: string;
    specialtyId?: string;
    subSpecialties?: string[];
    languages?: string[];
    experienceYears?: number;
    licenseNumber?: string;
    licenseVerified: boolean;
    verificationStatus: 'pending' | 'verified' | 'rejected';
    clinicIds?: string[];
    clinicLocation?: string;
    mapLocation?: { lat: number; lng: number };
    appointmentDuration: number;
    slotInterval: number;
    bufferBefore?: number;
    bufferAfter?: number;
    acceptAutoBooking: boolean;
    allowReschedule: boolean;
    bookingLeadTimeHours?: number;
    cancellationWindowHours?: number;
    consultationFee?: number;
    followUpFee?: number;
    currency?: string;
    assistantIds?: string[];
    acceptingNewPatients?: boolean;
    isFeatured?: boolean;
    status: 'draft' | 'active' | 'inactive' | 'suspended';
    notesInternal?: string;
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
    mapLocation?: { lat?: number; lng?: number };
    workingDays?: { day: number; enabled: boolean; from?: string; to?: string }[];
    status: 'active' | 'inactive' | 'suspended';
    createdBy?: string;
    notesInternal?: string;
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
    createdBy?: string;
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
    appointmentNumber: string;
    patientId: string;
    doctorId: string;
    clinicId: string;
    specialtyId?: string;
    date: Date;
    startTime: string;
    endTime: string;
    status: 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show';
    bookedBy?: string;
    bookingSource?: 'app' | 'admin_panel' | 'phone';
    reason?: string;
    notesInternal?: string;
    cancelReason?: string;
    rescheduledFrom?: string;
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

- add a unique compound constraint on `doctorId + date + startTime`

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
