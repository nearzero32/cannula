# Specialty Model Documentation

## Purpose

The `Specialty` model stores medical specialty categories used by the platform (for example: cardiology, dermatology, pediatrics).

It is used to:

- organize doctors by specialty
- support filtering/search in doctor listings
- control visibility of specialties via status
- manage display order in UI lists

## Schema Overview

```ts
import mongoose, { Schema, model, models } from 'mongoose';
import { ISpecialtyStatusEnum } from '../interfaces/specialty.interface';
import type { ISpecialty } from '../interfaces/specialty.interface';

export type SpecialtyDocument = mongoose.Document & ISpecialty;

const specialtySchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      maxlength: 120,
      index: true,
    },

    description: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: null,
    },

    icon: {
      type: String,
      default: null,
    },

    status: {
      type: String,
      enum: Object.values(ISpecialtyStatusEnum),
      default: ISpecialtyStatusEnum.ACTIVE,
      index: true,
    },

    sortOrder: {
      type: Number,
      default: 0,
    },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

specialtySchema.index({ name: 1 }, { unique: true });
specialtySchema.index({ status: 1, sortOrder: 1 });

export const specialties =
  (models.Specialty as mongoose.Model<SpecialtyDocument>) || model<SpecialtyDocument>('specialties', specialtySchema);
export default specialties;
```

## Fields

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `String` | Yes | Specialty name. Trimmed, unique, max 120 chars, indexed. |
| `description` | `String` | No | Optional short description. Trimmed, max 1000 chars, defaults to `null`. |
| `icon` | `String` | No | Optional icon/logo URL or path. Defaults to `null`. |
| `status` | `String` | Yes | Operational status. Enum values: `active`, `inactive`. Default: `active`. |
| `sortOrder` | `Number` | No | Numeric ordering priority for UI display. Default: `0`. |
| `createdBy` | `ObjectId` | No | Reference to the `User` who created the specialty. |
| `createdAt` | `Date` | Auto | Auto-generated when document is created (`timestamps: true`). |
| `updatedAt` | `Date` | Auto | Auto-updated on changes (`timestamps: true`). |

## Indexes

```ts
specialtySchema.index({ name: 1 }, { unique: true });
specialtySchema.index({ status: 1, sortOrder: 1 });
```

- `name` unique index prevents duplicate specialty names.
- `status + sortOrder` index supports listing active/inactive specialties in ordered views.

## Enum Source of Truth

Status values come from `ISpecialtyStatusEnum` in `src/interfaces/specialty.interface.ts`:

- `active`
- `inactive`
