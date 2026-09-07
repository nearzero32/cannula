import type mongoose from 'mongoose';
import type { IBaseDocument } from './common.interface';

export const PATIENT_MEDICATION_DEFAULT_TIMEZONE = 'Asia/Baghdad';
export const PATIENT_MEDICATION_MAX_TIMES_PER_DAY = 8;
export const PATIENT_MEDICATION_MAX_ACTIVE = 50;

export const PatientMedicationStatusEnum = {
    ACTIVE: 'active',
    ARCHIVED: 'archived',
} as const;
export type PatientMedicationStatus = typeof PatientMedicationStatusEnum[keyof typeof PatientMedicationStatusEnum];

export interface PatientMedicationSchedule {
    timezone: string;
    /** Sunday=0 through Saturday=6. Daily schedules contain all seven values. */
    weekdays: number[];
    times: string[];
    start_date: string;
    end_date?: string | null;
}

export interface IPatientMedication extends IBaseDocument {
    patient_id: mongoose.Types.ObjectId;
    name: string;
    strength_text?: string | null;
    dose_instructions?: string | null;
    notes?: string | null;
    schedule: PatientMedicationSchedule;
    reminders_enabled: boolean;
    schedule_version: number;
    status: PatientMedicationStatus;
}

