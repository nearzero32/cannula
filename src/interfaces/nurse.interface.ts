import type mongoose from 'mongoose';
import type { IBaseDocument, IWithNotesInternal } from './common.interface';

export const INurseGenderEnum = { MALE: 'male', FEMALE: 'female' } as const;
export type INurseGender = (typeof INurseGenderEnum)[keyof typeof INurseGenderEnum];

export const INurseStatusEnum = {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
    SUSPENDED: 'suspended',
} as const;
export type INurseStatus = (typeof INurseStatusEnum)[keyof typeof INurseStatusEnum];

export interface INurse extends IBaseDocument, IWithNotesInternal {
    user_id: mongoose.Types.ObjectId;
    full_name: string;
    gender?: INurseGender | null;
    profile_photo?: string | null;
    specialty?: string | null;
    license_number?: string | null;
    license_verified: boolean;
    experience_years?: number | null;
    qualified_service_ids: mongoose.Types.ObjectId[];
    status: INurseStatus;
}
