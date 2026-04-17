import mongoose, { Schema, model, models } from 'mongoose';
import { IPatientBloodGroupEnum, IPatientGenderEnum, IPatientStatusEnum } from '../interfaces/patient.interface';
import type { IPatient } from '../interfaces/patient.interface';

export type PatientDocument = mongoose.Document & IPatient;

const patientSchema = new Schema(
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

        gender: {
            type: String,
            enum: Object.values(IPatientGenderEnum),
            default: null,
        },

        dateOfBirth: {
            type: Date,
            default: null,
        },

        phone: {
            type: String,
            trim: true,
            default: null,
        },

        address: {
            type: String,
            trim: true,
            maxlength: 300,
            default: null,
        },

        profilePhoto: {
            type: String,
            default: null,
        },

        bloodGroup: {
            type: String,
            enum: Object.values(IPatientBloodGroupEnum),
            default: null,
        },

        allergies: {
            type: [String],
            default: [],
        },
        chronicConditions: {
            type: [String],
            default: [],
        },

        emergencyContactName: {
            type: String,
            trim: true,
            maxlength: 120,
            default: null,
        },
        emergencyContactPhone: {
            type: String,
            trim: true,
            default: null,
        },

        status: {
            type: String,
            enum: Object.values(IPatientStatusEnum),
            default: IPatientStatusEnum.ACTIVE,
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

patientSchema.index({ fullName: 1 });
patientSchema.index({ status: 1 });

export const Patient = (models.Patient as mongoose.Model<PatientDocument>) || model<PatientDocument>('Patient', patientSchema);
export default Patient;