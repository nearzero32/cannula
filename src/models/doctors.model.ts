import mongoose, { Schema, model, models } from 'mongoose';
import {
    IDoctorGenderEnum,
    IDoctorStatusEnum,
    IDoctorVerificationStatusEnum,
} from '../interfaces/doctor.interface';
import type { IDoctor } from '../interfaces/doctor.interface';

export type DoctorDocument = mongoose.Document & IDoctor;

const doctorSchema = new Schema(
    {
        user_id: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
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

        specialty: {
            type: String,
            required: true,
            trim: true,
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
            enum: Object.values(IDoctorVerificationStatusEnum),
            default: IDoctorVerificationStatusEnum.PENDING,
        },

        clinic_ids: [
            {
                type: Schema.Types.ObjectId,
                ref: 'Clinic',
            },
        ],

        clinic_location: {
            type: String,
            trim: true,
            default: null,
        },

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
            enum: Object.values(IDoctorStatusEnum),
            default: IDoctorStatusEnum.DRAFT,
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

export const Doctor = (models.Doctor as mongoose.Model<DoctorDocument>) || model<DoctorDocument>('Doctor', doctorSchema);
export default Doctor;