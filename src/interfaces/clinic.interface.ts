import type mongoose from 'mongoose';
import type { IBaseDocument, IWithNotesInternal, IWithCreatedBy } from './common.interface';

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

export interface IClinic extends IBaseDocument, IWithNotesInternal, IWithCreatedBy {
    name: string;
    description?: string | null;
    address: string;
    mapLocation?: IClinicMapLocation | null;
    workingDays: IClinicWorkingDay[];
    status: IClinicStatus;
}
