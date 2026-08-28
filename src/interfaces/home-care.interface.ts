import type mongoose from 'mongoose';
import type { IBaseDocument, IWithCreatedBy } from './common.interface';

export const IHomeCareStatusEnum = {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
} as const;

export type IHomeCareStatus = (typeof IHomeCareStatusEnum)[keyof typeof IHomeCareStatusEnum];

export interface IHomeCareCategory extends IBaseDocument, IWithCreatedBy {
    name: string;
    normalized_name: string;
    description?: string | null;
    icon?: string | null;
    image?: string | null;
    status: IHomeCareStatus;
    display_order: number;
    seed_key?: string | null;
}

export interface IHomeCareService extends IBaseDocument, IWithCreatedBy {
    category_id: mongoose.Types.ObjectId;
    name: string;
    short_description?: string | null;
    description?: string | null;
    image?: string | null;
    duration_min?: number | null;
    duration_max?: number | null;
    price: number;
    status: IHomeCareStatus;
    display_order: number;
}

