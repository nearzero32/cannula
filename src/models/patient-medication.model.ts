import mongoose, { Schema, model, models } from 'mongoose';
import type { IPatientMedication } from '../interfaces/patient-medication.interface';
import { PATIENT_MEDICATION_DEFAULT_TIMEZONE, PATIENT_MEDICATION_MAX_TIMES_PER_DAY, PatientMedicationStatusEnum } from '../interfaces/patient-medication.interface';

export type PatientMedicationDocument = mongoose.Document & IPatientMedication;

const scheduleSchema = new Schema({
    timezone: { type: String, required: true, trim: true, maxlength: 100, default: PATIENT_MEDICATION_DEFAULT_TIMEZONE },
    weekdays: { type: [Number], required: true, validate: [(v: number[]) => v.length >= 1 && v.length <= 7 && new Set(v).size === v.length && v.every(n => Number.isInteger(n) && n >= 0 && n <= 6), 'أيام التذكير غير صالحة'] },
    times: { type: [String], required: true, validate: [(v: string[]) => v.length >= 1 && v.length <= PATIENT_MEDICATION_MAX_TIMES_PER_DAY && new Set(v).size === v.length && v.every(x => /^([01]\d|2[0-3]):[0-5]\d$/.test(x)), 'أوقات التذكير غير صالحة'] },
    start_date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    end_date: { type: String, default: null, validate: [(v: string | null) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), 'تاريخ النهاية غير صالح'] },
}, { _id: false });

const schema = new Schema<PatientMedicationDocument>({
    patient_id: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, immutable: true },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
    strength_text: { type: String, trim: true, maxlength: 120, default: null },
    dose_instructions: { type: String, trim: true, maxlength: 500, default: null },
    notes: { type: String, trim: true, maxlength: 2000, default: null },
    schedule: { type: scheduleSchema, required: true },
    reminders_enabled: { type: Boolean, default: true },
    schedule_version: { type: Number, required: true, min: 1, default: 1 },
    status: { type: String, enum: Object.values(PatientMedicationStatusEnum), default: PatientMedicationStatusEnum.ACTIVE },
}, { timestamps: true, versionKey: false });

schema.index({ patient_id: 1, status: 1 });
schema.index({ patient_id: 1, reminders_enabled: 1 });
schema.index({ status: 1, reminders_enabled: 1, 'schedule.end_date': 1 });

export const PatientMedication = (models.PatientMedication as mongoose.Model<PatientMedicationDocument>) || model<PatientMedicationDocument>('PatientMedication', schema);
export default PatientMedication;

