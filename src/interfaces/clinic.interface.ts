import type { IBaseDocument, IWithCreatedBy } from './common.interface';

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

export interface IClinic extends IBaseDocument, IWithCreatedBy {
    name: string;
    description?: string | null;
    address: string;
    icon?: string | null;
    map_location?: IClinicMapLocation | null;
    status: IClinicStatus;
}
