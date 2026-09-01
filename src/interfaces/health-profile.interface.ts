import type mongoose from 'mongoose';
import type { IBaseDocument } from './common.interface';

export const BloodTypeEnum = {
    A_POSITIVE: 'A+',
    A_NEGATIVE: 'A-',
    B_POSITIVE: 'B+',
    B_NEGATIVE: 'B-',
    AB_POSITIVE: 'AB+',
    AB_NEGATIVE: 'AB-',
    O_POSITIVE: 'O+',
    O_NEGATIVE: 'O-',
} as const;

export type BloodType = (typeof BloodTypeEnum)[keyof typeof BloodTypeEnum];

export interface HealthProfileFields {
    blood_type?: BloodType | null;
    /** Weight in kilograms. */
    weight?: number | null;
    /** Height in centimeters. */
    height?: number | null;
    allergies: string[];
    chronic_condition_ids: mongoose.Types.ObjectId[];
    current_medications: string[];
    medical_notes?: string | null;
}

export interface IPatientHealthProfile extends IBaseDocument, HealthProfileFields {
    patient_id: mongoose.Types.ObjectId;
}

export interface IChildHealthProfile extends IBaseDocument, HealthProfileFields {
    child_id: mongoose.Types.ObjectId;
}

/** Fields a patient or guardian may manage in the current MVP. */
export type PatientManagedHealthProfileUpdate = Partial<Pick<
    HealthProfileFields,
    'blood_type' | 'allergies' | 'chronic_condition_ids'
>>;
