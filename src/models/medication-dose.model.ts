import mongoose, { Schema, model, models } from 'mongoose';
import type { IMedicationDose } from '../interfaces/medication-dose.interface';
import { MedicationDoseStatusEnum } from '../interfaces/medication-dose.interface';

export type MedicationDoseDocument = mongoose.Document & IMedicationDose;

const snapshotSchema = new Schema({
    name: { type: String, required: true, maxlength: 120 },
    strength_text: { type: String, default: null, maxlength: 120 },
    dose_instructions: { type: String, default: null, maxlength: 500 },
}, { _id: false });

const schema = new Schema<MedicationDoseDocument>({
    medication_id: { type: Schema.Types.ObjectId, ref: 'PatientMedication', required: true, immutable: true },
    patient_id: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, immutable: true },
    schedule_version: { type: Number, required: true, min: 1, immutable: true },
    scheduled_at: { type: Date, required: true, immutable: true },
    medication_snapshot: { type: snapshotSchema, required: true },
    status: { type: String, enum: Object.values(MedicationDoseStatusEnum), default: MedicationDoseStatusEnum.PENDING },
    taken_at: { type: Date, default: null },
    recorded_at: { type: Date, default: null },
}, { timestamps: true, versionKey: false });

schema.index({ medication_id: 1, schedule_version: 1, scheduled_at: 1 }, { unique: true });
schema.index({ patient_id: 1, scheduled_at: 1 });
schema.index({ status: 1, scheduled_at: 1 });

export const MedicationDose = (models.MedicationDose as mongoose.Model<MedicationDoseDocument>) || model<MedicationDoseDocument>('MedicationDose', schema);
export default MedicationDose;
