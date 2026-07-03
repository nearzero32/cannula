# Clinic Model Documentation

The `Clinic` model represents the physical clinic entity in the system. It stores the clinic's core identity, address, map coordinates, and operational status.

## Purpose

This model defines where medical services are provided. It links doctors and appointments to a real location while keeping clinic information independent from doctor profile data.

## Schema Overview

```ts
import mongoose, { Schema, model, models } from 'mongoose';
import { IClinicStatusEnum } from '../interfaces/clinic.interface';

const clinicSchema = new Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 150,
        },
        description: {
            type: String,
            trim: true,
            maxlength: 2000,
            default: null,
        },
        address: {
            type: String,
            required: true,
            trim: true,
            maxlength: 300,
        },
        icon: {
            type: String,
            default: null,
        },
        map_location: {
            lat: { type: Number, default: null },
            lng: { type: Number, default: null },
        },
        status: {
            type: String,
            enum: Object.values(IClinicStatusEnum),
            default: IClinicStatusEnum.ACTIVE,
        },
        created_by: {
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

clinicSchema.index({ name: 1 });
clinicSchema.index({ status: 1 });
```

## Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | `String` | Yes | Clinic name (max 150 chars). |
| `description` | `String` | No | Short overview (max 2000 chars). |
| `address` | `String` | Yes | Human-readable address (max 300 chars). |
| `icon` | `String` | No | Icon/logo URL from R2 upload. |
| `map_location.lat` | `Number` | No | Latitude for map display. |
| `map_location.lng` | `Number` | No | Longitude for map display. |
| `status` | `String` | Yes | `active`, `inactive`, or `suspended`. |
| `created_by` | `ObjectId` | No | Admin `User` who created the record. |
| `createdAt` | `Date` | Auto | Creation timestamp. |
| `updatedAt` | `Date` | Auto | Last update timestamp. |

## Usage Rules

- Keep clinic-level location data here only.
- Do not store doctor profiles or appointments in this document.
- Doctor availability and working hours belong on the `Doctor` model or a separate schedule collection.
