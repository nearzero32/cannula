import mongoose, { Schema, model, models } from 'mongoose';
import {
    IAppointmentBookingSourceEnum,
    IAppointmentStatusEnum,
    IAppointmentPaymentStatusEnum,
    IAppointmentCancelledByModelEnum,
} from '../interfaces/appointment.interface';
import type { IAppointment } from '../interfaces/appointment.interface';

export type AppointmentDocument = mongoose.Document & IAppointment;

const appointmentSchema = new Schema(
    {
        /**
         * Unique appointment number used for display, invoices, and tracking.
         * Example: APP-2026-000001
         */
        appointment_number: {
            type: String,
            required: true,
            trim: true,
            unique: true,
            index: true,
        },

        /**
         * The patient who booked the appointment.
         */
        patient_id: {
            type: Schema.Types.ObjectId,
            ref: 'Patient',
            required: true,
            index: true,
        },

        /**
         * The doctor assigned to this appointment.
         */
        doctor_id: {
            type: Schema.Types.ObjectId,
            ref: 'Doctor',
            required: true,
            index: true,
        },

        /**
         * The clinic where the appointment will take place.
         */
        clinic_id: {
            type: Schema.Types.ObjectId,
            ref: 'Clinic',
            required: true,
            index: true,
        },

        /**
         * Optional specialty related to the appointment.
         * Useful when doctors have multiple specialties.
         */
        specialty_id: {
            type: Schema.Types.ObjectId,
            ref: 'Specialty',
            default: null,
            index: true,
        },

        /**
         * Appointment date.
         * Recommended: store this normalized to the start of the day.
         * Example: 2026-06-21T00:00:00.000Z
         */
        date: {
            type: Date,
            required: true,
            index: true,
        },

        /**
         * Appointment start time as display text.
         * Example: "09:30"
         */
        starts_at: {
            type: String,
            required: false,
            default: null,
            trim: true,
        },

        /**
         * Appointment end time as display text.
         * Example: "10:00"
         */
        ends_at: {
            type: String,
            required: false,
            default: null,
            trim: true,
        },

        /**
         * Current appointment status.
         * Example: pending, confirmed, cancelled, completed, no_show
         */
        status: {
            type: String,
            enum: Object.values(IAppointmentStatusEnum),
            default: IAppointmentStatusEnum.PENDING,
            index: true,
        },

        /**
         * The system user who created the appointment.
         * Usually used when booking is created from admin panel or receptionist.
         * Null when booked directly by the patient from the app.
         */
        booked_by: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },

        /**
         * Source of the booking.
         * Example: app, admin_panel, phone
         */
        booking_source: {
            type: String,
            enum: Object.values(IAppointmentBookingSourceEnum),
            default: IAppointmentBookingSourceEnum.APP,
        },

        /**
         * Patient-provided reason for the visit.
         */
        reason: {
            type: String,
            trim: true,
            maxlength: 1000,
            default: null,
        },

        /**
         * Private notes written by clinic staff.
         * These notes should not be visible to the patient.
         */
        notes_internal: {
            type: String,
            trim: true,
            maxlength: 2000,
            default: null,
        },

        /**
         * Reason why the appointment was cancelled.
         */
        cancel_reason: {
            type: String,
            trim: true,
            maxlength: 1000,
            default: null,
        },

        /**
         * The entity that cancelled the appointment.
         * Can be a Patient, Doctor, or User depending on cancelled_by_model.
         */
        cancelled_by: {
            type: Schema.Types.ObjectId,
            refPath: 'cancelled_by_model',
            default: null,
        },

        /**
         * Dynamic reference model for cancelled_by.
         */
        cancelled_by_model: {
            type: String,
            enum: Object.values(IAppointmentCancelledByModelEnum),
            default: null,
        },

        /**
         * Date and time when the appointment was cancelled.
         */
        cancelled_at: {
            type: Date,
            default: null,
        },

        /**
         * Reference to the previous appointment if this appointment was created
         * as a reschedule of another appointment.
         */
        rescheduled_from: {
            type: Schema.Types.ObjectId,
            ref: 'Appointment',
            default: null,
        },

        /**
         * Reference to the new appointment if this appointment was rescheduled
         * to another time.
         */
        rescheduled_to: {
            type: Schema.Types.ObjectId,
            ref: 'Appointment',
            default: null,
        },

        /**
         * Payment status for the appointment.
         * Useful if the clinic supports prepaid bookings or appointment fees.
         */
        payment_status: {
            type: String,
            enum: Object.values(IAppointmentPaymentStatusEnum),
            default: IAppointmentPaymentStatusEnum.UNPAID,
        },

        /**
         * Date and time when the patient arrived at the clinic.
         */
        checked_in_at: {
            type: Date,
            default: null,
        },

        /**
         * Date and time when the appointment was completed.
         */
        completed_at: {
            type: Date,
            default: null,
        },

        /**
         * Appointment fee.
         * Keep it 0 if the appointment is free or payment is handled elsewhere.
         */
        appointment_fee: {
            type: Number,
            default: 0,
            min: 0,
        },
    },
    {
        /**
         * Automatically adds createdAt and updatedAt fields.
         */
        timestamps: true,
    }
);

/**
 * Prevents double booking for the same doctor at the same date and start time.
 *
 * Cancelled and no-show appointments are excluded, so their time slots
 * can be booked again if needed.
 */
appointmentSchema.index(
    { doctor_id: 1, date: 1, start_time: 1 },
    {
        unique: true,
        partialFilterExpression: {
            status: {
                $nin: [
                    IAppointmentStatusEnum.CANCELLED,
                    IAppointmentStatusEnum.NO_SHOW,
                ],
            },
        },
    }
);

/**
 * Improves queries for patient appointment history.
 */
appointmentSchema.index({ patient_id: 1, date: 1 });

/**
 * Improves queries for clinic daily appointments.
 */
appointmentSchema.index({ clinic_id: 1, date: 1 });

/**
 * Improves filtering appointments by status and date.
 */
appointmentSchema.index({ status: 1, date: 1 });

/**
 * Improves doctor schedule queries inside a specific clinic.
 */
appointmentSchema.index({ clinic_id: 1, doctor_id: 1, date: 1 });

export const Appointment =
    (models.Appointment as mongoose.Model<AppointmentDocument>) ||
    model<AppointmentDocument>('Appointment', appointmentSchema);

export default Appointment;