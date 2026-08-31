import type mongoose from 'mongoose';

export const HomeCareHistoryEventEnum = {
    REQUEST_CREATED: 'REQUEST_CREATED', CLAIMED_BY_NURSE: 'CLAIMED_BY_NURSE',
    ASSIGNED_BY_ADMIN: 'ASSIGNED_BY_ADMIN', REASSIGNED_BY_ADMIN: 'REASSIGNED_BY_ADMIN',
    UNASSIGNED_BY_ADMIN: 'UNASSIGNED_BY_ADMIN', STATUS_CHANGED: 'STATUS_CHANGED',
    REQUEST_CANCELLED: 'REQUEST_CANCELLED', REQUEST_REJECTED: 'REQUEST_REJECTED',
    REQUEST_REOPENED: 'REQUEST_REOPENED', COMPLETED: 'COMPLETED',
} as const;
export type HomeCareHistoryEvent = (typeof HomeCareHistoryEventEnum)[keyof typeof HomeCareHistoryEventEnum];

export const HomeCareHistoryActorTypeEnum = {
    PATIENT: 'PATIENT', NURSE: 'NURSE', ADMIN: 'ADMIN', SYSTEM: 'SYSTEM',
} as const;
export type HomeCareHistoryActorType = (typeof HomeCareHistoryActorTypeEnum)[keyof typeof HomeCareHistoryActorTypeEnum];

export interface IHomeCareRequestHistory {
    _id: string;
    request_id: mongoose.Types.ObjectId;
    request_number: string;
    event_type: HomeCareHistoryEvent;
    actor: { type: HomeCareHistoryActorType; user_id?: mongoose.Types.ObjectId | null; nurse_id?: mongoose.Types.ObjectId | null };
    from_status?: string | null;
    to_status?: string | null;
    from_nurse_id?: mongoose.Types.ObjectId | null;
    to_nurse_id?: mongoose.Types.ObjectId | null;
    dispatch_mode?: string | null;
    reason?: string | null;
    metadata?: Record<string, string | number | boolean | null> | null;
    createdAt: Date;
}
