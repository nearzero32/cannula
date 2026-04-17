# Appointment Model Documentation

## Purpose

The `Appointment` model stores booking records between patients and doctors at a clinic.

It is used to:

- track appointment identity (`appointmentNumber`)
- connect patient, doctor, clinic, and optional specialty
- manage lifecycle status (`pending`, `confirmed`, etc.)
- support operational data (booking source, internal notes, cancellation, reschedule)

## Schema Overview

```ts
import mongoose, { Schema, model, models } from 'mongoose';
import { IAppointmentBookingSourceEnum, IAppointmentStatusEnum } from '../interfaces/appointment.interface';
import type { IAppointment } from '../interfaces/appointment.interface';

export type AppointmentDocument = mongoose.Document & IAppointment;

const appointmentSchema = new Schema(
    {
        appointmentNumber: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            index: true,
        },
        patientId: {
            type: Schema.Types.ObjectId,
            ref: 'Patient',
            required: true,
            index: true,
        },
        doctorId: {
            type: Schema.Types.ObjectId,
            ref: 'Doctor',
            required: true,
            index: true,
        },
        clinicId: {
            type: Schema.Types.ObjectId,
            ref: 'Clinic',
            required: true,
            index: true,
        },
        specialtyId: {
            type: Schema.Types.ObjectId,
            ref: 'Specialty',
            default: null,
            index: true,
        },
        date: {
            type: Date,
            required: true,
            index: true,
        },
        startTime: {
            type: String,
            required: true,
            trim: true,
        },
        endTime: {
            type: String,
            required: true,
            trim: true,
        },
        status: {
            type: String,
            enum: Object.values(IAppointmentStatusEnum),
            default: IAppointmentStatusEnum.PENDING,
            index: true,
        },
        bookedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        bookingSource: {
            type: String,
            enum: Object.values(IAppointmentBookingSourceEnum),
            default: IAppointmentBookingSourceEnum.APP,
        },
        reason: {
            type: String,
            trim: true,
            maxlength: 1000,
            default: null,
        },
        notesInternal: {
            type: String,
            trim: true,
            maxlength: 2000,
            default: null,
        },
        cancelReason: {
            type: String,
            trim: true,
            maxlength: 1000,
            default: null,
        },
        rescheduledFrom: {
            type: Schema.Types.ObjectId,
            ref: 'Appointment',
            default: null,
        },
    },
    {
        timestamps: true,
        versionKey: false,
    }
);

appointmentSchema.index({ doctorId: 1, date: 1, startTime: 1 });
appointmentSchema.index({ patientId: 1, date: 1 });
appointmentSchema.index({ clinicId: 1, date: 1 });
appointmentSchema.index({ status: 1, date: 1 });

export const Appointment =
    (models.Appointment as mongoose.Model<AppointmentDocument>) ||
    model<AppointmentDocument>('Appointment', appointmentSchema);
export default Appointment;
```

## Fields

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `appointmentNumber` | `String` | Yes | Unique booking identifier, trimmed and indexed. |
| `patientId` | `ObjectId` | Yes | Reference to patient record (`Patient`). |
| `doctorId` | `ObjectId` | Yes | Reference to doctor profile (`Doctor`). |
| `clinicId` | `ObjectId` | Yes | Reference to clinic (`Clinic`). |
| `specialtyId` | `ObjectId` | No | Optional reference to specialty (`Specialty`). |
| `date` | `Date` | Yes | Appointment date (indexed). |
| `startTime` | `String` | Yes | Start time string for the slot. |
| `endTime` | `String` | Yes | End time string for the slot. |
| `status` | `String` | Yes | Lifecycle state. Default: `pending`. |
| `bookedBy` | `ObjectId` | No | Optional `User` who created booking (for admin-assisted bookings). |
| `bookingSource` | `String` | Yes | Booking origin. Default: `app`. |
| `reason` | `String` | No | Optional patient complaint or booking reason. |
| `notesInternal` | `String` | No | Internal staff/admin notes (not for patient display). |
| `cancelReason` | `String` | No | Optional cancellation reason. |
| `rescheduledFrom` | `ObjectId` | No | Optional previous appointment reference if rescheduled. |
| `createdAt` | `Date` | Auto | Auto-generated create timestamp. |
| `updatedAt` | `Date` | Auto | Auto-generated update timestamp. |

## Enum Source of Truth

Values are centralized in `src/interfaces/appointment.interface.ts`.

- `IAppointmentStatusEnum`: `pending`, `confirmed`, `cancelled`, `completed`, `no_show`
- `IAppointmentBookingSourceEnum`: `app`, `admin_panel`, `phone`

## Indexes

```ts
appointmentSchema.index({ doctorId: 1, date: 1, startTime: 1 });
appointmentSchema.index({ patientId: 1, date: 1 });
appointmentSchema.index({ clinicId: 1, date: 1 });
appointmentSchema.index({ status: 1, date: 1 });
```

- `doctorId + date + startTime` supports doctor schedule queries.
- `patientId + date` supports patient history/upcoming lookups.
- `clinicId + date` supports clinic-level daily schedule views.
- `status + date` supports operational filtering by state.
