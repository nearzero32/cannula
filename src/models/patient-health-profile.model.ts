import mongoose, { Schema, model, models } from 'mongoose';
import type { IPatientHealthProfile } from '../interfaces/health-profile.interface';
import { healthProfileFields } from './health-profile-fields';

export type PatientHealthProfileDocument = mongoose.Document & IPatientHealthProfile;

const patientHealthProfileSchema = new Schema(
    {
        patient_id: {
            type: Schema.Types.ObjectId,
            ref: 'Patient',
            required: true,
        },
        ...healthProfileFields,
    },
    { timestamps: true, versionKey: false }
);

patientHealthProfileSchema.index({ patient_id: 1 }, { unique: true });

const PatientHealthProfile =
    (models.PatientHealthProfile as mongoose.Model<PatientHealthProfileDocument>) ||
    model<PatientHealthProfileDocument>('PatientHealthProfile', patientHealthProfileSchema);

export default PatientHealthProfile;
