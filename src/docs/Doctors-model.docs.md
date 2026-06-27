# Doctor Model Documentation

## Purpose

The `Doctor` model stores a doctor's core professional profile in Kanona.

It is used for:
- doctor listing and search
- booking defaults
- verification workflows
- clinic linkage

To keep this model focused, fast-changing data (for example: generated slots, appointment transactions, or uploaded verification files) should live in separate collections.

## Field Reference

| Field | Type | Required | Description |
|---|---|---|---|
| `user_id` | `ObjectId` | Yes | Links this doctor profile to the base `User` account (one user, one doctor profile). |
| `full_name` | `String` | Yes | Official/internal full name. |
| `display_name` | `String` | Yes | Public-facing name shown to patients. |
| `gender` | `String` | No | Optional display/filter value (`male` or `female`). |
| `profile_photo` | `String` | No | Profile image URL or file path. |
| `bio` | `String` | No | Short professional intro and focus areas. |
| `specialty` | `String` | Yes | Primary specialty used for search and filtering. |
| `sub_specialties` | `String[]` | No | Secondary specialty tags. |
| `languages` | `String[]` | No | Spoken languages for patient matching. |
| `experience_years` | `Number` | No | Years of professional experience. |
| `license_number` | `String` | No | Medical license or registration number. |
| `license_verified` | `Boolean` | Yes | License verification flag. |
| `verification_status` | `String` | Yes | Verification state: `pending`, `verified`, `rejected`. |
| `clinic_ids` | `ObjectId[]` | No | Related clinics where the doctor works. |
| `map_location` | `{ lat, lng }` | No | Coordinates for map/location features. |
| `appointment_duration` | `Number` | Yes | Default appointment duration in minutes. |
| `slot_interval` | `Number` | Yes | Slot split interval in minutes. |
| `buffer_before` | `Number` | No | Extra minutes before each appointment. |
| `buffer_after` | `Number` | No | Extra minutes after each appointment. |
| `accept_auto_booking` | `Boolean` | Yes | If true, bookings are auto-accepted. |
| `allow_reschedule` | `Boolean` | Yes | If true, patients can reschedule appointments. |
| `booking_lead_time_hours` | `Number` | No | Minimum hours required before booking. |
| `cancellation_window_hours` | `Number` | No | Minimum hours required before cancellation. |
| `consultation_fee` | `Number` | No | Standard consultation price. |
| `follow_up_fee` | `Number` | No | Follow-up/review appointment price. |
| `currency` | `String` | No | Currency code (default: `IQD`). |
| `assistant_ids` | `ObjectId[]` | No | Linked assistants/reception users. |
| `accepting_new_patients` | `Boolean` | No | Whether the doctor currently accepts new patients. |
| `is_featured` | `Boolean` | No | Admin highlight flag for listings. |
| `status` | `String` | Yes | Profile state: `draft`, `active`, `inactive`, `suspended`. |
| `notes_internal` | `String` | No | Internal admin notes (not visible to patients). |
| `createdAt` | `Date` | Auto | Auto-set at create time. |
| `updatedAt` | `Date` | Auto | Auto-updated on changes. |

## Mongoose Schema

```ts
import mongoose, { Schema, model, models } from 'mongoose';

const doctorSchema = new Schema(
    {
        user_id: {
            type: Schema.Types.ObjectId,
            ref: 'User',
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
        display_name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 120,
        },
        gender: {
            type: String,
            enum: ['male', 'female'],
            default: null,
        },
        profile_photo: {
            type: String,
            default: null,
        },
        bio: {
            type: String,
            trim: true,
            maxlength: 1500,
            default: null,
        },

        specialty: {
            type: String,
            required: true,
            trim: true,
            index: true,
        },
        sub_specialties: {
            type: [String],
            default: [],
        },
        languages: {
            type: [String],
            default: [],
        },
        experience_years: {
            type: Number,
            min: 0,
            default: null,
        },

        license_number: {
            type: String,
            trim: true,
            default: null,
        },
        license_verified: {
            type: Boolean,
            default: false,
        },
        verification_status: {
            type: String,
            enum: ['pending', 'verified', 'rejected'],
            default: 'pending',
            index: true,
        },

        clinic_ids: [
            {
                type: Schema.Types.ObjectId,
                ref: 'Clinic',
            },
        ],
        map_location: {
            lat: { type: Number, default: null },
            lng: { type: Number, default: null },
        },

        appointment_duration: {
            type: Number,
            required: true,
            default: 30,
            min: 5,
        },
        slot_interval: {
            type: Number,
            required: true,
            default: 15,
            min: 5,
        },
        buffer_before: {
            type: Number,
            default: 0,
            min: 0,
        },
        buffer_after: {
            type: Number,
            default: 0,
            min: 0,
        },

        accept_auto_booking: {
            type: Boolean,
            default: false,
        },
        allow_reschedule: {
            type: Boolean,
            default: true,
        },
        booking_lead_time_hours: {
            type: Number,
            default: 1,
            min: 0,
        },
        cancellation_window_hours: {
            type: Number,
            default: 24,
            min: 0,
        },

        consultation_fee: {
            type: Number,
            min: 0,
            default: null,
        },
        follow_up_fee: {
            type: Number,
            min: 0,
            default: null,
        },
        currency: {
            type: String,
            trim: true,
            default: 'IQD',
        },

        assistant_ids: [
            {
                type: Schema.Types.ObjectId,
                ref: 'User',
            },
        ],
        accepting_new_patients: {
            type: Boolean,
            default: true,
        },
        is_featured: {
            type: Boolean,
            default: false,
        },

        status: {
            type: String,
            enum: ['draft', 'active', 'inactive', 'suspended'],
            default: 'draft',
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
    }
);

doctorSchema.index({ specialty: 1, status: 1 });
doctorSchema.index({ verification_status: 1, status: 1 });
doctorSchema.index({ clinic_ids: 1 });

export const Doctor = models.Doctor || model('Doctor', doctorSchema);
```