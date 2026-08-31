import type mongoose from 'mongoose';
import type { IBaseDocument } from './common.interface';

export const IHomeCareRequestStatusEnum = {
    PENDING: 'pending',
    CONFIRMED: 'confirmed',
    ASSIGNED: 'assigned',
    ON_THE_WAY: 'on_the_way',
    ARRIVED: 'arrived',
    IN_PROGRESS: 'in_progress',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
    REJECTED: 'rejected',
} as const;

export type IHomeCareRequestStatus =
    (typeof IHomeCareRequestStatusEnum)[keyof typeof IHomeCareRequestStatusEnum];

export const IHomeCareDispatchStatusEnum = { OPEN: 'OPEN', CLAIMED: 'CLAIMED', CLOSED: 'CLOSED' } as const;
export type IHomeCareDispatchStatus = (typeof IHomeCareDispatchStatusEnum)[keyof typeof IHomeCareDispatchStatusEnum];
export const IHomeCareDispatchModeEnum = {
    OPEN_POOL: 'OPEN_POOL', ADMIN_DIRECT: 'ADMIN_DIRECT', ADMIN_REASSIGN: 'ADMIN_REASSIGN',
} as const;
export type IHomeCareDispatchMode = (typeof IHomeCareDispatchModeEnum)[keyof typeof IHomeCareDispatchModeEnum];

export interface IHomeCareRequestDispatch {
    status: IHomeCareDispatchStatus;
    mode: IHomeCareDispatchMode;
    nurse_id?: mongoose.Types.ObjectId | null;
    assigned_at?: Date | null;
    assigned_by_user_id?: mongoose.Types.ObjectId | null;
    version: number;
}

export const IHomeCareRequestCancelledByTypeEnum = {
    PATIENT: 'PATIENT',
    ADMIN: 'ADMIN',
} as const;

export type IHomeCareRequestCancelledByType =
    (typeof IHomeCareRequestCancelledByTypeEnum)[keyof typeof IHomeCareRequestCancelledByTypeEnum];

export interface IHomeCareRequestAddress {
    address_text: string;
    lat: number;
    lng: number;
}

export interface IHomeCareRequestCancelledBy {
    id: mongoose.Types.ObjectId;
    type: IHomeCareRequestCancelledByType;
}

export interface IHomeCareRequest extends IBaseDocument {
    request_number: string;
    patient_id: mongoose.Types.ObjectId;
    child_id?: mongoose.Types.ObjectId | null;
    category_id: mongoose.Types.ObjectId;
    service_id: mongoose.Types.ObjectId;
    service_name: string;
    service_price: number;
    service_duration_min?: number | null;
    service_duration_max?: number | null;
    requested_date: Date;
    preferred_time: string;
    address: IHomeCareRequestAddress;
    notes?: string | null;
    status: IHomeCareRequestStatus;
    dispatch: IHomeCareRequestDispatch;
    internal_notes?: string | null;
    cancelled_at?: Date | null;
    cancelled_by?: IHomeCareRequestCancelledBy | null;
    cancellation_reason?: string | null;
}
