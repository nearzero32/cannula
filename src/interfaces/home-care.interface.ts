import type mongoose from 'mongoose';
import type { IBaseDocument, IWithCreatedBy } from './common.interface';

export const IHomeCareStatusEnum = {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
} as const;

export type IHomeCareStatus = (typeof IHomeCareStatusEnum)[keyof typeof IHomeCareStatusEnum];

export const HomeCareWeekdayEnum = {
    SATURDAY: 'SATURDAY',
    SUNDAY: 'SUNDAY',
    MONDAY: 'MONDAY',
    TUESDAY: 'TUESDAY',
    WEDNESDAY: 'WEDNESDAY',
    THURSDAY: 'THURSDAY',
    FRIDAY: 'FRIDAY',
} as const;

export type HomeCareWeekday = (typeof HomeCareWeekdayEnum)[keyof typeof HomeCareWeekdayEnum];
export const HOME_CARE_WEEKDAYS: readonly HomeCareWeekday[] = Object.values(HomeCareWeekdayEnum);

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

export interface IHomeCareAvailabilitySlot extends IBaseDocument, IWithCreatedBy {
    service_id: mongoose.Types.ObjectId;
    day_of_week: HomeCareWeekday;
    time: string;
    status: IHomeCareStatus;
    display_order: number;
    selection_version?: number;
}
