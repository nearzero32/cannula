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
| `userId` | `ObjectId` | Yes | Links this doctor profile to the base `User` account (one user, one doctor profile). |
| `fullName` | `String` | Yes | Official/internal full name. |
| `displayName` | `String` | Yes | Public-facing name shown to patients. |
| `gender` | `String` | No | Optional display/filter value (`male` or `female`). |
| `profilePhoto` | `String` | No | Profile image URL or file path. |
| `bio` | `String` | No | Short professional intro and focus areas. |
| `specialty` | `String` | Yes | Primary specialty used for search and filtering. |
| `subSpecialties` | `String[]` | No | Secondary specialty tags. |
| `languages` | `String[]` | No | Spoken languages for patient matching. |
| `experienceYears` | `Number` | No | Years of professional experience. |
| `licenseNumber` | `String` | No | Medical license or registration number. |
| `licenseVerified` | `Boolean` | Yes | License verification flag. |
| `verificationStatus` | `String` | Yes | Verification state: `pending`, `verified`, `rejected`. |
| `clinicIds` | `ObjectId[]` | No | Related clinics where the doctor works. |
| `clinicLocation` | `String` | No | Human-readable location/city. |
| `mapLocation` | `{ lat, lng }` | No | Coordinates for map/location features. |
| `appointmentDuration` | `Number` | Yes | Default appointment duration in minutes. |
| `slotInterval` | `Number` | Yes | Slot split interval in minutes. |
| `bufferBefore` | `Number` | No | Extra minutes before each appointment. |
| `bufferAfter` | `Number` | No | Extra minutes after each appointment. |
| `acceptAutoBooking` | `Boolean` | Yes | If true, bookings are auto-accepted. |
| `allowReschedule` | `Boolean` | Yes | If true, patients can reschedule appointments. |
| `bookingLeadTimeHours` | `Number` | No | Minimum hours required before booking. |
| `cancellationWindowHours` | `Number` | No | Minimum hours required before cancellation. |
| `consultationFee` | `Number` | No | Standard consultation price. |
| `followUpFee` | `Number` | No | Follow-up/review appointment price. |
| `currency` | `String` | No | Currency code (default: `IQD`). |
| `assistantIds` | `ObjectId[]` | No | Linked assistants/reception users. |
| `acceptingNewPatients` | `Boolean` | No | Whether the doctor currently accepts new patients. |
| `isFeatured` | `Boolean` | No | Admin highlight flag for listings. |
| `status` | `String` | Yes | Profile state: `draft`, `active`, `inactive`, `suspended`. |
| `notesInternal` | `String` | No | Internal admin notes (not visible to patients). |
| `createdAt` | `Date` | Auto | Auto-set at create time. |
| `updatedAt` | `Date` | Auto | Auto-updated on changes. |

## Mongoose Schema

```ts
import mongoose, { Schema, model, models } from 'mongoose';

const doctorSchema = new Schema(
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
        displayName: {
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
        profilePhoto: {
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
        subSpecialties: {
            type: [String],
            default: [],
        },
        languages: {
            type: [String],
            default: [],
        },
        experienceYears: {
            type: Number,
            min: 0,
            default: null,
        },

        licenseNumber: {
            type: String,
            trim: true,
            default: null,
        },
        licenseVerified: {
            type: Boolean,
            default: false,
        },
        verificationStatus: {
            type: String,
            enum: ['pending', 'verified', 'rejected'],
            default: 'pending',
            index: true,
        },

        clinicIds: [
            {
                type: Schema.Types.ObjectId,
                ref: 'Clinic',
            },
        ],
        clinicLocation: {
            type: String,
            trim: true,
            default: null,
        },
        mapLocation: {
            lat: { type: Number, default: null },
            lng: { type: Number, default: null },
        },

        appointmentDuration: {
            type: Number,
            required: true,
            default: 30,
            min: 5,
        },
        slotInterval: {
            type: Number,
            required: true,
            default: 15,
            min: 5,
        },
        bufferBefore: {
            type: Number,
            default: 0,
            min: 0,
        },
        bufferAfter: {
            type: Number,
            default: 0,
            min: 0,
        },

        acceptAutoBooking: {
            type: Boolean,
            default: false,
        },
        allowReschedule: {
            type: Boolean,
            default: true,
        },
        bookingLeadTimeHours: {
            type: Number,
            default: 1,
            min: 0,
        },
        cancellationWindowHours: {
            type: Number,
            default: 24,
            min: 0,
        },

        consultationFee: {
            type: Number,
            min: 0,
            default: null,
        },
        followUpFee: {
            type: Number,
            min: 0,
            default: null,
        },
        currency: {
            type: String,
            trim: true,
            default: 'IQD',
        },

        assistantIds: [
            {
                type: Schema.Types.ObjectId,
                ref: 'User',
            },
        ],
        acceptingNewPatients: {
            type: Boolean,
            default: true,
        },
        isFeatured: {
            type: Boolean,
            default: false,
        },

        status: {
            type: String,
            enum: ['draft', 'active', 'inactive', 'suspended'],
            default: 'draft',
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

doctorSchema.index({ specialty: 1, status: 1 });
doctorSchema.index({ verificationStatus: 1, status: 1 });
doctorSchema.index({ clinicIds: 1 });

export const Doctor = models.Doctor || model('Doctor', doctorSchema);
```