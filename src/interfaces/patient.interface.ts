import type mongoose from 'mongoose';
import type { IBaseDocument, IWithNotesInternal } from './common.interface';

export const IPatientGenderEnum = {
    MALE: 'male',
    FEMALE: 'female',
} as const;

export type IPatientGender = (typeof IPatientGenderEnum)[keyof typeof IPatientGenderEnum];

export const IPatientBloodGroupEnum = {
    A_POSITIVE: 'A+',
    A_NEGATIVE: 'A-',
    B_POSITIVE: 'B+',
    B_NEGATIVE: 'B-',
    AB_POSITIVE: 'AB+',
    AB_NEGATIVE: 'AB-',
    O_POSITIVE: 'O+',
    O_NEGATIVE: 'O-',
} as const;

export type IPatientBloodGroup = (typeof IPatientBloodGroupEnum)[keyof typeof IPatientBloodGroupEnum];

export const IPatientStatusEnum = {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
    BLOCKED: 'blocked',
} as const;

export type IPatientStatus = (typeof IPatientStatusEnum)[keyof typeof IPatientStatusEnum];

export interface IPatient extends IBaseDocument, IWithNotesInternal {
    user_id: mongoose.Types.ObjectId;
    full_name: string;
    gender?: IPatientGender | null;
    date_of_birth?: Date | null;
    phone?: string | null;
    address?: string | null;
    profile_photo?: string | null;
    blood_group?: IPatientBloodGroup | null;
    allergies: string[];
    chronic_conditions: string[];
    emergency_contact_name?: string | null;
    emergency_contact_phone?: string | null;
    status: IPatientStatus;
}
