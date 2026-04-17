import type mongoose from 'mongoose';

export const IClinicStatusEnum = {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
    SUSPENDED: 'suspended',
} as const;

export type IClinicStatus = (typeof IClinicStatusEnum)[keyof typeof IClinicStatusEnum];

export interface IClinicMapLocation {
    lat?: number | null;
    lng?: number | null;
}

export interface IClinicWorkingDay {
    day: number;
    enabled: boolean;
    from?: string | null;
    to?: string | null;
}

export interface IClinic {
    _id: string;
    name: string;
    description?: string | null;
    address: string;
    mapLocation?: IClinicMapLocation | null;
    workingDays: IClinicWorkingDay[];
    status: IClinicStatus;
    createdBy?: mongoose.Types.ObjectId | null;
    notesInternal?: string | null;
    createdAt: Date;
    updatedAt: Date;
}
