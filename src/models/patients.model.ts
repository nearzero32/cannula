import mongoose, { Schema, model, models } from 'mongoose';
import { IPatientBloodGroupEnum, IPatientGenderEnum, IPatientStatusEnum } from '../interfaces/patient.interface';
import type { IPatient } from '../interfaces/patient.interface';

export type PatientDocument = mongoose.Document & IPatient;

const patientSchema = new Schema(
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

        gender: {
            type: String,
            enum: Object.values(IPatientGenderEnum),
            default: null,
        },

        date_of_birth: {
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

        profile_photo: {
            type: String,
            default: null,
        },

        blood_group: {
            type: String,
            enum: Object.values(IPatientBloodGroupEnum),
            default: null,
        },

        allergies: {
            type: [String],
            default: [],
        },
        chronic_conditions: {
            type: [String],
            default: [],
        },

        emergency_contact_name: {
            type: String,
            trim: true,
            maxlength: 120,
            default: null,
        },
        emergency_contact_phone: {
            type: String,
            trim: true,
            default: null,
        },

        status: {
            type: String,
            enum: Object.values(IPatientStatusEnum),
            default: IPatientStatusEnum.ACTIVE,
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

patientSchema.index({ full_name: 1 });
patientSchema.index({ status: 1 });

export const Patient = (models.Patient as mongoose.Model<PatientDocument>) || model<PatientDocument>('Patient', patientSchema);
export default Patient;