import type mongoose from 'mongoose';

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

export interface IPatient {
    _id: string;
    userId: mongoose.Types.ObjectId;
    fullName: string;
    gender?: IPatientGender | null;
    dateOfBirth?: Date | null;
    phone?: string | null;
    address?: string | null;
    profilePhoto?: string | null;
    bloodGroup?: IPatientBloodGroup | null;
    allergies: string[];
    chronicConditions: string[];
    emergencyContactName?: string | null;
    emergencyContactPhone?: string | null;
    status: IPatientStatus;
    notesInternal?: string | null;
    createdAt: Date;
    updatedAt: Date;
}
