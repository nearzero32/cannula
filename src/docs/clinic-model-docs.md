# Clinic Model Documentation

The `Clinic` model represents the physical clinic entity in the system. It stores the clinic’s core identity, address, map coordinates, general working schedule, operational status, and internal admin metadata. Separating clinics from doctors is a common pattern in appointment platforms because one clinic may contain multiple doctors and one doctor may work with one or more clinics.[cite:107][cite:110]

## Purpose

This model is used to define where medical services are provided. It helps the system attach doctors and appointments to a real location, while keeping clinic information independent from doctor profile data.[cite:107][cite:110]

For the current MVP, this model is suitable because it keeps only the essential clinic information: name, description, address, map location, working days, status, and internal metadata. That keeps the collection small and clear while still supporting doctor linkage and appointment location display.[cite:107][cite:110]

## Schema Overview

```ts
import mongoose, { Schema, model, models } from "mongoose";

const clinicSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 150,
      index: true,
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

    mapLocation: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
    },

    workingDays: [
      {
        day: {
          type: Number,
          min: 0,
          max: 6,
          required: true,
        },
        enabled: {
          type: Boolean,
          default: true,
        },
        from: {
          type: String,
          default: null,
        },
        to: {
          type: String,
          default: null,
        },
      },
    ],

    status: {
      type: String,
      enum: ["active", "inactive", "suspended"],
      default: "active",
      index: true,
    },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
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
  },
);

clinicSchema.index({ name: 1 });
clinicSchema.index({ city: 1, governorate: 1, status: 1 });

export const Clinic = models.Clinic || model("Clinic", clinicSchema);
```

## Fields

| Field                 | Type       | Required | Description                                                                                                                                      |
| --------------------- | ---------- | -------: | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`                | `String`   |      Yes | The clinic name shown in the system. It is trimmed, required, limited to 150 characters, and indexed for faster search.[cite:110]                |
| `description`         | `String`   |       No | A short explanation or overview of the clinic. It is optional, trimmed, and can be up to 2000 characters.                                        |
| `address`             | `String`   |      Yes | The readable clinic address used in UI and appointment details. It is required, trimmed, and limited to 300 characters.[cite:110]                |
| `icon`                | `String`   |       No | Optional clinic icon/logo URL or path. This field is not required and defaults to `null`.                                                        |
| `mapLocation.lat`     | `Number`   |       No | Latitude value used for map display and geographic location.                                                                                     |
| `mapLocation.lng`     | `Number`   |       No | Longitude value used for map display and geographic location.                                                                                    |
| `workingDays`         | `Array`    |       No | An array that stores the clinic’s general weekly schedule. This supports operational hours separate from doctor-specific availability.[cite:107] |
| `workingDays.day`     | `Number`   |      Yes | Day number from `0` to `6`, usually representing the days of the week in application logic.                                                      |
| `workingDays.enabled` | `Boolean`  |       No | Indicates whether the clinic is open on that day. Default is `true`.                                                                             |
| `workingDays.from`    | `String`   |       No | Start time for that working day, such as `09:00`.                                                                                                |
| `workingDays.to`      | `String`   |       No | End time for that working day, such as `17:00`.                                                                                                  |
| `status`              | `String`   |      Yes | Operational state of the clinic. Allowed values are `active`, `inactive`, and `suspended`, with `active` as the default.                         |
| `createdBy`           | `ObjectId` |       No | Reference to the `User` who created the clinic record, usually an admin account.                                                                 |
| `notesInternal`       | `String`   |       No | Internal notes for admins only. This field should not be exposed to doctors or patients.                                                         |
| `createdAt`           | `Date`     |     Auto | Automatically generated creation timestamp because `timestamps: true` is enabled.                                                                |
| `updatedAt`           | `Date`     |     Auto | Automatically generated update timestamp because `timestamps: true` is enabled.                                                                  |

## Field Groups

### Identity

The clinic identity in this schema is mainly represented by `name`, with optional visual branding through the `icon` field. Since this is an MVP, keeping identity minimal is acceptable if the platform currently does not need slugs, branch codes, or full public profile pages.[cite:107][cite:110]

### Location

The clinic location is represented by `address` and `mapLocation`. This gives both a human-readable address and optional coordinates for maps or location-aware features.[cite:110]

### Working Schedule

The `workingDays` array stores the general weekly schedule of the clinic itself. This should be treated as clinic-level working hours only, not the doctor’s actual appointment availability, because doctor schedules often vary independently from clinic opening hours.[cite:107]

### Operational State

The `status` field controls whether the clinic is usable in the system. A typical use is:

- `active`: clinic can appear in the app and accept doctor relations or appointments.
- `inactive`: clinic exists in the database but is temporarily not in use.
- `suspended`: clinic is blocked for operational or administrative reasons.

### Internal Metadata

The `createdBy` field helps track which admin created the clinic record, while `notesInternal` is useful for admin-only comments. This supports operational control without exposing internal notes to end users. Administrative tracking is a common requirement in systems that manage healthcare entities centrally.[cite:106][cite:107]

## Indexes

The schema defines these indexes:

```ts
clinicSchema.index({ name: 1 });
clinicSchema.index({ city: 1, governorate: 1, status: 1 });
```

The first index on `name` is valid and useful for search or sorting by clinic name. The second index references `city` and `governorate`, but those fields do not exist in the current schema, so this index should either be removed or those fields should be added to the model to avoid a mismatch between the schema and the intended query pattern.[cite:110]

## Issues to Fix

There is one important issue in the current code: the schema includes an index on `city` and `governorate`, but those fields are not defined in the model. This means the code currently describes a broader location strategy than the actual schema implements, and it should be aligned before production use. [cite:110]

Two valid options exist:

1. Remove this index if the application only needs `address` and `mapLocation` for now.
2. Add `city` and `governorate` fields if the system will filter clinics by city or governorate later.

## Recommended Clean Version

If the current MVP truly does not need `city` and `governorate`, the cleaner index section is:

```ts
clinicSchema.index({ name: 1 });
clinicSchema.index({ status: 1 });
```

That version better matches the actual fields currently present in the schema.

## Suggested Usage Rules

- Keep this model for clinic-level information only.
- Do not store doctor profiles inside the clinic document.
- Do not store appointments inside the clinic document.
- Use doctor records to reference clinic IDs, or use appointment records with `clinicId` references.
- Keep doctor availability separate from clinic working days, because they represent different business rules.[cite:107][cite:110]

## Summary of Scope

This `Clinic` model is a good MVP structure for Kanona because it captures the clinic’s identity, address, schedule, status, and admin metadata without mixing in doctor or appointment details. The main correction needed is to align the indexes with the actual schema fields before moving forward.[cite:107][cite:110]
