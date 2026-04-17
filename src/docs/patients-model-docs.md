# Patient Model Documentation

## Purpose

The `Patient` model stores a patient's core profile and basic medical context used for appointments.

It is used to:

- link a patient profile to a base `User` account
- support booking and lookup by patient identity
- keep basic health context (blood group, allergies, chronic conditions)
- track operational patient state (`active`, `inactive`, `blocked`)

## Schema Overview

```ts
import mongoose, { Schema, model, models } from 'mongoose';
import { IPatientBloodGroupEnum, IPatientGenderEnum, IPatientStatusEnum } from '../interfaces/patient.interface';
import type { IPatient } from '../interfaces/patient.interface';

export type PatientDocument = mongoose.Document & IPatient;

const patientSchema = new Schema(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            unique: true,
            index: true,
        },
        fullName: {
            type: String,
            required: true,
            trim: true,
            maxlength: 120,
        },
        gender: {
            type: String,
            enum: Object.values(IPatientGenderEnum),
            default: null,
        },
        dateOfBirth: {
            type: Date,
            default: null,
        },
        phone: {
            type: String,
            trim: true,
            default: null,
        },
        address: {
            type: String,
            trim: true,
            maxlength: 300,
            default: null,
        },
        profilePhoto: {
            type: String,
            default: null,
        },
        bloodGroup: {
            type: String,
            enum: Object.values(IPatientBloodGroupEnum),
            default: null,
        },
        allergies: {
            type: [String],
            default: [],
        },
        chronicConditions: {
            type: [String],
            default: [],
        },
        emergencyContactName: {
            type: String,
            trim: true,
            maxlength: 120,
            default: null,
        },
        emergencyContactPhone: {
            type: String,
            trim: true,
            default: null,
        },
        status: {
            type: String,
            enum: Object.values(IPatientStatusEnum),
            default: IPatientStatusEnum.ACTIVE,
            index: true,
        },
        notesInternal: {
            type: String,
            trim: true,
            maxlength: 2000,
            default: null,
        },
    },
    {
        timestamps: true,
        versionKey: false,
    }
);

patientSchema.index({ fullName: 1 });
patientSchema.index({ status: 1 });

export const Patient = (models.Patient as mongoose.Model<PatientDocument>) || model<PatientDocument>('Patient', patientSchema);
export default Patient;
```

## Fields

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `userId` | `ObjectId` | Yes | Reference to the base `User` account (one patient profile per user). |
| `fullName` | `String` | Yes | Patient full name, trimmed, max 120 chars. |
| `gender` | `String` | No | Optional gender value: `male` or `female`. |
| `dateOfBirth` | `Date` | No | Optional birth date. |
| `phone` | `String` | No | Optional patient phone number. |
| `address` | `String` | No | Optional address, max 300 chars. |
| `profilePhoto` | `String` | No | Optional profile image URL/path. |
| `bloodGroup` | `String` | No | Optional blood group (`A+`, `A-`, `B+`, `B-`, `AB+`, `AB-`, `O+`, `O-`). |
| `allergies` | `String[]` | No | List of known allergy tags/notes. |
| `chronicConditions` | `String[]` | No | List of chronic condition tags/notes. |
| `emergencyContactName` | `String` | No | Optional emergency contact name. |
| `emergencyContactPhone` | `String` | No | Optional emergency contact phone. |
| `status` | `String` | Yes | Operational state: `active`, `inactive`, `blocked`. Default: `active`. |
| `notesInternal` | `String` | No | Internal notes for staff/admin use. |
| `createdAt` | `Date` | Auto | Auto-generated create timestamp (`timestamps: true`). |
| `updatedAt` | `Date` | Auto | Auto-generated update timestamp (`timestamps: true`). |

## Enum Source of Truth

Values are centralized in `src/interfaces/patient.interface.ts`.

- `IPatientGenderEnum`: `male`, `female`
- `IPatientBloodGroupEnum`: `A+`, `A-`, `B+`, `B-`, `AB+`, `AB-`, `O+`, `O-`
- `IPatientStatusEnum`: `active`, `inactive`, `blocked`

## Indexes

```ts
patientSchema.index({ fullName: 1 });
patientSchema.index({ status: 1 });
```

- `fullName` index supports quick patient name lookup.
- `status` index supports operational filtering.
