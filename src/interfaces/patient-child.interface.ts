import type mongoose from 'mongoose';
import type { IBaseDocument } from './common.interface';
import type { IPatientGender } from './patient.interface';

export const PatientChildStatusEnum = {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
} as const;

export type PatientChildStatus =
    (typeof PatientChildStatusEnum)[keyof typeof PatientChildStatusEnum];

export interface IPatientChild extends IBaseDocument {
    patient_id: mongoose.Types.ObjectId;
    full_name: string;
    date_of_birth: Date;
    gender: IPatientGender;
    photo?: string | null;
    status: PatientChildStatus;
}

export interface PatientChildCreateInput {
    full_name: string;
    date_of_birth: Date;
    gender: IPatientGender;
    photo?: string | null;
}

export type PatientChildUpdateInput = Partial<PatientChildCreateInput>;
