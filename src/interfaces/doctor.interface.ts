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
    user_id: mongoose.Types.ObjectId;
    full_name: string;
    display_name: string;
    gender?: IDoctorGender | null;
    profile_photo?: string | null;
    bio?: string | null;
    specialty: string;
    sub_specialties: string[];
    languages: string[];
    experience_years?: number | null;
    license_number?: string | null;
    license_verified: boolean;
    verification_status: IDoctorVerificationStatus;
    clinic_ids: mongoose.Types.ObjectId[];
    clinic_location?: string | null;
    map_location?: IDoctorMapLocation | null;
    appointment_duration: number;
    slot_interval: number;
    buffer_before: number;
    buffer_after: number;
    accept_auto_booking: boolean;
    allow_reschedule: boolean;
    booking_lead_time_hours: number;
    cancellation_window_hours: number;
    consultation_fee?: number | null;
    follow_up_fee?: number | null;
    currency?: string | null;
    assistant_ids: mongoose.Types.ObjectId[];
    accepting_new_patients: boolean;
    is_featured: boolean;
    status: IDoctorStatus;
}
