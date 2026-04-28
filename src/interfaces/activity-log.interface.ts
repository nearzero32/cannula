import mongoose from 'mongoose';
import type { ITimestamps } from './common.interface';

export const IActivityLogActionEnum = {
    CREATE: 'create',
    UPDATE: 'update',
    DELETE: 'delete',
    BULK_UPDATE: 'bulk_update',
    BULK_DELETE: 'bulk_delete',
    OTHER: 'other',
} as const;

export type IActivityLogAction = (typeof IActivityLogActionEnum)[keyof typeof IActivityLogActionEnum];

export const IActivityLogSourceEnum = {
    COUNTING: 'counting',
    DASHBOARD: 'dashboard',
    ADMIN: 'admin',
    MOBILE: 'mobile',
} as const;

export type IActivityLogSource = (typeof IActivityLogSourceEnum)[keyof typeof IActivityLogSourceEnum];

export interface IActivityLog extends ITimestamps {
    user_id: mongoose.Types.ObjectId;
    user_name: string;
    user_type: string;
    method: string;
    endpoint: string;
    action: IActivityLogAction;
    collection_name: string;
    document_id: mongoose.Types.ObjectId | null;
    old_data: unknown | null;
    new_data: unknown | null;
    changed_fields: string[];
    request_body: unknown;
    response_status: number;
    ip_address: string;
    source: IActivityLogSource;
}
