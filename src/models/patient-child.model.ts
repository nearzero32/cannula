import mongoose, { Schema, model, models } from 'mongoose';
import type { IPatientChild } from '../interfaces/patient-child.interface';
import { PatientChildRelationshipEnum, PatientChildStatusEnum } from '../interfaces/patient-child.interface';
import { IPatientGenderEnum } from '../interfaces/patient.interface';

export type PatientChildDocument = mongoose.Document & IPatientChild;

const patientChildSchema = new Schema(
    {
        patient_id: {
            type: Schema.Types.ObjectId,
            ref: 'Patient',
            required: true,
        },
        full_name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 120,
        },
        date_of_birth: {
            type: Date,
            required: true,
            validate: {
                validator: (value: Date) => !Number.isNaN(value.getTime()) &&
                    value.toISOString().slice(0, 10) >= '1900-01-01' &&
                    value.toISOString().slice(0, 10) <= new Date().toISOString().slice(0, 10),
                message: 'تاريخ الميلاد غير صالح أو قديم جداً أو في المستقبل',
            },
        },
        gender: {
            type: String,
            enum: Object.values(IPatientGenderEnum),
            required: true,
        },
        relationship: {
            type: String,
            enum: Object.values(PatientChildRelationshipEnum),
            default: PatientChildRelationshipEnum.OTHER,
            required: true,
        },
        photo: {
            type: String,
            trim: true,
            default: null,
        },
        status: {
            type: String,
            enum: Object.values(PatientChildStatusEnum),
            default: PatientChildStatusEnum.ACTIVE,
        },
    },
    { timestamps: true, versionKey: false }
);

patientChildSchema.index({ patient_id: 1, status: 1, createdAt: 1 });

const PatientChild =
    (models.PatientChild as mongoose.Model<PatientChildDocument>) ||
    model<PatientChildDocument>('PatientChild', patientChildSchema);

export default PatientChild;
