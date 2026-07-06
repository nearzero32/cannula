import mongoose, { Schema, model, models } from 'mongoose';
import {
    IDoctorGenderEnum,
    IDoctorStatusEnum,
    IDoctorVerificationStatusEnum,
} from '../interfaces/doctor.interface';
import type { IDoctor } from '../interfaces/doctor.interface';

export type DoctorDocument = mongoose.Document & IDoctor;

/**
 * Doctor profile — professional identity, clinic linkage, and booking defaults.
 * Auth credentials live on `User`; this collection holds role-specific data only.
 * A doctor becomes bookable when `status = active` and verification is approved.
 */
const doctorSchema = new Schema(
    {
        // ── Identity (linked to User) ────────────────────────────────────────────

        /** One-to-one link to the base User account (role must be `doctor`). */
        user_id: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },

        /** Official / internal name (admin and records). */
        full_name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 120,
        },

        /** Public-facing name shown to patients in listings and booking. */
        display_name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 120,
        },

        gender: {
            type: String,
            enum: Object.values(IDoctorGenderEnum),
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

        // ── Professional info ────────────────────────────────────────────────────

        /**
         * Primary specialty label used for search/filter.
         * Stored as plain text today; consider migrating to a Specialty ObjectId ref.
         */
        specialty: {
            type: String,
            required: true,
            trim: true,
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

        /** Set by admin when license is manually confirmed. */
        license_verified: {
            type: Boolean,
            default: false,
        },

        /** Admin verification workflow: pending → verified | rejected. */
        verification_status: {
            type: String,
            enum: Object.values(IDoctorVerificationStatusEnum),
            default: IDoctorVerificationStatusEnum.PENDING,
        },

        // ── clinics ───────────────────────────────────────────────────

        /** Clinics where this doctor practises (many-to-many). */
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

        // ── Booking defaults ─────────────────────────────────────────────────────
        // Used when generating available slots and validating new appointments.
        // Per-day exceptions belong in a future `doctor_availability` collection.

        /** Default appointment length in minutes. */
        appointment_duration: {
            type: Number,
            required: true,
            default: 30,
            min: 5,
        },

        /** Grid step between slot start times in minutes (may differ from duration). */
        slot_interval: {
            type: Number,
            required: true,
            default: 15,
            min: 5,
        },

        /** Extra blocked minutes before each slot. */
        buffer_before: {
            type: Number,
            default: 0,
            min: 0,
        },

        /** Extra blocked minutes after each slot. */
        buffer_after: {
            type: Number,
            default: 0,
            min: 0,
        },

        /** When true, new bookings skip the pending state and go straight to confirmed. */
        accept_auto_booking: {
            type: Boolean,
            default: false,
        },

        allow_reschedule: {
            type: Boolean,
            default: true,
        },

        /** Minimum hours before appointment start that a patient may book. */
        booking_lead_time_hours: {
            type: Number,
            default: 1,
            min: 0,
        },

        /** Minimum hours before start that a patient may cancel without penalty. */
        cancellation_window_hours: {
            type: Number,
            default: 24,
            min: 0,
        },

        // ── Fees ─────────────────────────────────────────────────────────────────

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

        // ── Staff & visibility ───────────────────────────────────────────────────

        /** Linked assistant/reception User accounts. */
        assistant_ids: [
            {
                type: Schema.Types.ObjectId,
                ref: 'User',
            },
        ],

        /**
         * Operational profile state. Only `active` doctors accept bookings.
         * New profiles start as `draft` until admin activates them.
         */
        status: {
            type: String,
            enum: Object.values(IDoctorStatusEnum),
            default: IDoctorStatusEnum.DRAFT,
        },

        /** Admin-only notes; never exposed to patients or doctors. */
        notes_internal: {
            type: String,
            trim: true,
            maxlength: 2000,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

// Listing/filter queries by specialty and operational state
doctorSchema.index({ specialty: 1, status: 1 });
// Admin verification queue
doctorSchema.index({ verification_status: 1, status: 1 });
// Find doctors assigned to a clinic
doctorSchema.index({ clinic_ids: 1 });

export const Doctor = (models.Doctor as mongoose.Model<DoctorDocument>) || model<DoctorDocument>('Doctor', doctorSchema);
export default Doctor;
