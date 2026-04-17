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
            enum: Object.values(IDoctorGenderEnum),
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
            enum: Object.values(IDoctorVerificationStatusEnum),
            default: IDoctorVerificationStatusEnum.PENDING,
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
            enum: Object.values(IDoctorStatusEnum),
            default: IDoctorStatusEnum.DRAFT,
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

export const Doctor = (models.Doctor as mongoose.Model<DoctorDocument>) || model<DoctorDocument>('Doctor', doctorSchema);
export default Doctor;