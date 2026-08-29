import type mongoose from 'mongoose';
import type { IBaseDocument, IWithNotesInternal } from './common.interface';
import { BloodTypeEnum, type BloodType } from './health-profile.interface';

export const IPatientGenderEnum = {
    MALE: 'male',
    FEMALE: 'female',
} as const;

export type IPatientGender = (typeof IPatientGenderEnum)[keyof typeof IPatientGenderEnum];

/** @deprecated Health data now belongs to PatientHealthProfile. */
export const IPatientBloodGroupEnum = BloodTypeEnum;
/** @deprecated Use BloodType from health-profile.interface. */
export type IPatientBloodGroup = BloodType;

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
    status: IPatientStatus;
}
