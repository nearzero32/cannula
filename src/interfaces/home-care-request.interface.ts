import type mongoose from 'mongoose';
import type { IBaseDocument } from './common.interface';

export const IHomeCareRequestStatusEnum = {
    PENDING: 'pending',
    CONFIRMED: 'confirmed',
    IN_PROGRESS: 'in_progress',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
    REJECTED: 'rejected',
} as const;

export type IHomeCareRequestStatus =
    (typeof IHomeCareRequestStatusEnum)[keyof typeof IHomeCareRequestStatusEnum];

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
    internal_notes?: string | null;
    cancelled_at?: Date | null;
    cancelled_by?: IHomeCareRequestCancelledBy | null;
    cancellation_reason?: string | null;
}
