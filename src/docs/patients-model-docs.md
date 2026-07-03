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
import mongoose, { Schema, model, models } from "mongoose";
import {
  IPatientBloodGroupEnum,
  IPatientGenderEnum,
  IPatientStatusEnum,
} from "../interfaces/patient.interface";
import type { IPatient } from "../interfaces/patient.interface";

export type PatientDocument = mongoose.Document & IPatient;

const patientSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    full_name: {
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
    date_of_birth: {
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
    profile_photo: {
      type: String,
      default: null,
    },
    blood_group: {
      type: String,
      enum: Object.values(IPatientBloodGroupEnum),
      default: null,
    },
    allergies: {
      type: [String],
      default: [],
    },
    chronic_condition_ids: {
      type: [String],
      default: [],
    },
    status: {
      type: String,
      enum: Object.values(IPatientStatusEnum),
      default: IPatientStatusEnum.ACTIVE,
      index: true,
    },
    notes_internal: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

patientSchema.index({ full_name: 1 });
patientSchema.index({ status: 1 });

export const Patient =
  (models.Patient as mongoose.Model<PatientDocument>) ||
  model<PatientDocument>("Patient", patientSchema);
export default Patient;
```

## Fields

| Field                   | Type       | Required | Description                                                              |
| ----------------------- | ---------- | -------- | ------------------------------------------------------------------------ |
| `user_id`               | `ObjectId` | Yes      | Reference to the base `User` account (one patient profile per user).     |
| `full_name`             | `String`   | Yes      | Patient full name, trimmed, max 120 chars.                               |
| `gender`                | `String`   | No       | Optional gender value: `male` or `female`.                               |
| `date_of_birth`         | `Date`     | No       | Optional birth date.                                                     |
| `phone`                 | `String`   | No       | Optional patient phone number.                                           |
| `address`               | `String`   | No       | Optional address, max 300 chars.                                         |
| `profile_photo`         | `String`   | No       | Optional profile image URL/path.                                         |
| `blood_group`           | `String`   | No       | Optional blood group (`A+`, `A-`, `B+`, `B-`, `AB+`, `AB-`, `O+`, `O-`). |
| `allergies`             | `String[]` | No       | List of known allergy tags/notes.                                        |
| `chronic_condition_ids` | `String[]` | No       | IDs of `ChronicCondition` catalog entries.                               |
| `status`                | `String`   | Yes      | Operational state: `active`, `inactive`, `blocked`. Default: `active`.   |
| `notes_internal`        | `String`   | No       | Internal notes for staff/admin use.                                      |
| `createdAt`             | `Date`     | Auto     | Auto-generated create timestamp (`timestamps: true`).                    |
| `updatedAt`             | `Date`     | Auto     | Auto-generated update timestamp (`timestamps: true`).                    |

## Enum Source of Truth

Values are centralized in `src/interfaces/patient.interface.ts`.

- `IPatientGenderEnum`: `male`, `female`
- `IPatientBloodGroupEnum`: `A+`, `A-`, `B+`, `B-`, `AB+`, `AB-`, `O+`, `O-`
- `IPatientStatusEnum`: `active`, `inactive`, `blocked`

## Indexes

```ts
patientSchema.index({ full_name: 1 });
patientSchema.index({ status: 1 });
```

- `full_name` index supports quick patient name lookup.
- `status` index supports operational filtering.
