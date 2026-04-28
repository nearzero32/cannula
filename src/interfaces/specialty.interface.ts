import type mongoose from 'mongoose';
import type { IBaseDocument, IWithCreatedBy } from './common.interface';

export const ISpecialtyStatusEnum = {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
} as const;

export type ISpecialtyStatus = (typeof ISpecialtyStatusEnum)[keyof typeof ISpecialtyStatusEnum];

export interface ISpecialty extends IBaseDocument, IWithCreatedBy {
    name: string;
    description?: string | null;
    icon?: string | null;
    status: ISpecialtyStatus;
    sort_order: number;
}
