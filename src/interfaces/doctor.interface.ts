import type mongoose from 'mongoose';
import type { IBaseDocument, IWithNotesInternal } from './common.interface';

export const IDoctorGenderEnum = {
    MALE: 'male',
    FEMALE: 'female',
} as const;

export type IDoctorGender = (typeof IDoctorGenderEnum)[keyof typeof IDoctorGenderEnum];

export const IDoctorVerificationStatusEnum = {
    PENDING: 'pending',
    VERIFIED: 'verified',
    REJECTED: 'rejected',
} as const;

export type IDoctorVerificationStatus =
    (typeof IDoctorVerificationStatusEnum)[keyof typeof IDoctorVerificationStatusEnum];

export const IDoctorStatusEnum = {
    DRAFT: 'draft',
    ACTIVE: 'active',
    INACTIVE: 'inactive',
    SUSPENDED: 'suspended',
} as const;

export type IDoctorStatus = (typeof IDoctorStatusEnum)[keyof typeof IDoctorStatusEnum];

export interface IDoctorMapLocation {
    lat?: number | null;
    lng?: number | null;
}

export interface IDoctor extends IBaseDocument, IWithNotesInternal {
    userId: mongoose.Types.ObjectId;
    fullName: string;
    displayName: string;
    gender?: IDoctorGender | null;
    profilePhoto?: string | null;
    bio?: string | null;
    specialty: string;
    subSpecialties: string[];
    languages: string[];
    experienceYears?: number | null;
    licenseNumber?: string | null;
    licenseVerified: boolean;
    verificationStatus: IDoctorVerificationStatus;
    clinicIds: mongoose.Types.ObjectId[];
    clinicLocation?: string | null;
    mapLocation?: IDoctorMapLocation | null;
    appointmentDuration: number;
    slotInterval: number;
    bufferBefore: number;
    bufferAfter: number;
    acceptAutoBooking: boolean;
    allowReschedule: boolean;
    bookingLeadTimeHours: number;
    cancellationWindowHours: number;
    consultationFee?: number | null;
    followUpFee?: number | null;
    currency?: string | null;
    assistantIds: mongoose.Types.ObjectId[];
    acceptingNewPatients: boolean;
    isFeatured: boolean;
    status: IDoctorStatus;
}
