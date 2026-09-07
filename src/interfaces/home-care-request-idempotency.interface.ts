import type mongoose from 'mongoose';
import type { IBaseDocument } from './common.interface';

export const HomeCareRequestIdempotencyStatusEnum = {
    PROCESSING: 'processing',
    COMPLETED: 'completed',
} as const;

export type HomeCareRequestIdempotencyStatus = typeof HomeCareRequestIdempotencyStatusEnum[keyof typeof HomeCareRequestIdempotencyStatusEnum];

export interface IHomeCareRequestIdempotency extends IBaseDocument {
    patient_id: mongoose.Types.ObjectId;
    idempotency_key: string;
    request_hash: string;
    status: HomeCareRequestIdempotencyStatus;
    request_id?: mongoose.Types.ObjectId | null;
    response_status?: number | null;
    expires_at: Date;
}
