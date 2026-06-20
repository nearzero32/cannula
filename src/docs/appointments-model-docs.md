# Appointment Model Documentation

## Purpose

The `Appointment` model stores booking records between patients and doctors at a clinic.

It is used to:

- track appointment identity (`appointment_number`)
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
        appointment_number: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            index: true,
        },
        patient_id: {
            type: Schema.Types.ObjectId,
            ref: 'Patient',
            required: true,
            index: true,
        },
        doctor_id: {
            type: Schema.Types.ObjectId,
            ref: 'Doctor',
            required: true,
            index: true,
        },
        clinic_id: {
            type: Schema.Types.ObjectId,
            ref: 'Clinic',
            required: true,
            index: true,
        },
        specialty_id: {
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
        start_time: {
            type: String,
            required: true,
            trim: true,
        },
        end_time: {
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
        booked_by: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        booking_source: {
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
        notes_internal: {
            type: String,
            trim: true,
            maxlength: 2000,
            default: null,
        },
        cancel_reason: {
            type: String,
            trim: true,
            maxlength: 1000,
            default: null,
        },
        rescheduled_from: {
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

appointmentSchema.index({ doctor_id: 1, date: 1, start_time: 1 });
appointmentSchema.index({ patient_id: 1, date: 1 });
appointmentSchema.index({ clinic_id: 1, date: 1 });
appointmentSchema.index({ status: 1, date: 1 });

export const Appointment =
    (models.Appointment as mongoose.Model<AppointmentDocument>) ||
    model<AppointmentDocument>('Appointment', appointmentSchema);
export default Appointment;
```

## Fields

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `appointment_number` | `String` | Yes | Unique booking identifier, trimmed and indexed. |
| `patient_id` | `ObjectId` | Yes | Reference to patient record (`Patient`). |
| `doctor_id` | `ObjectId` | Yes | Reference to doctor profile (`Doctor`). |
| `clinic_id` | `ObjectId` | Yes | Reference to clinic (`Clinic`). |
| `specialty_id` | `ObjectId` | No | Optional reference to specialty (`Specialty`). |
| `date` | `Date` | Yes | Appointment date (indexed). |
| `start_time` | `String` | Yes | Start time string for the slot. |
| `end_time` | `String` | Yes | End time string for the slot. |
| `status` | `String` | Yes | Lifecycle state. Default: `pending`. |
| `booked_by` | `ObjectId` | No | Optional `User` who created booking (for admin-assisted bookings). |
| `booking_source` | `String` | Yes | Booking origin. Default: `app`. |
| `reason` | `String` | No | Optional patient complaint or booking reason. |
| `notes_internal` | `String` | No | Internal staff/admin notes (not for patient display). |
| `cancel_reason` | `String` | No | Optional cancellation reason. |
| `rescheduled_from` | `ObjectId` | No | Optional previous appointment reference if rescheduled. |
| `createdAt` | `Date` | Auto | Auto-generated create timestamp. |
| `updatedAt` | `Date` | Auto | Auto-generated update timestamp. |

## Enum Source of Truth

Values are centralized in `src/interfaces/appointment.interface.ts`.

- `IAppointmentStatusEnum`: `pending`, `confirmed`, `cancelled`, `completed`, `no_show`
- `IAppointmentBookingSourceEnum`: `app`, `admin_panel`, `phone`

## Indexes

```ts
appointmentSchema.index({ doctor_id: 1, date: 1, start_time: 1 });
appointmentSchema.index({ patient_id: 1, date: 1 });
appointmentSchema.index({ clinic_id: 1, date: 1 });
appointmentSchema.index({ status: 1, date: 1 });
```

- `doctor_id + date + start_time` supports doctor schedule queries.
- `patient_id + date` supports patient history/upcoming lookups.
- `clinic_id + date` supports clinic-level daily schedule views.
- `status + date` supports operational filtering by state.
