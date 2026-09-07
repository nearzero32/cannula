import type mongoose from 'mongoose';
import type { IBaseDocument } from './common.interface';

export const MedicationDoseStatusEnum = {
    PENDING: 'PENDING',
    TAKEN: 'TAKEN',
    NOT_TAKEN: 'NOT_TAKEN',
    CANCELLED: 'CANCELLED',
} as const;
export type MedicationDoseStatus = typeof MedicationDoseStatusEnum[keyof typeof MedicationDoseStatusEnum];

export interface MedicationSnapshot {
    name: string;
    strength_text?: string | null;
    dose_instructions?: string | null;
}

export interface IMedicationDose extends IBaseDocument {
    medication_id: mongoose.Types.ObjectId;
    patient_id: mongoose.Types.ObjectId;
    schedule_version: number;
    scheduled_at: Date;
    medication_snapshot: MedicationSnapshot;
    status: MedicationDoseStatus;
    taken_at?: Date | null;
    recorded_at?: Date | null;
}

