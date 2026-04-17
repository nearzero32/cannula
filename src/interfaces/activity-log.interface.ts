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
    centerId: mongoose.Types.ObjectId | null;
    userId: mongoose.Types.ObjectId;
    userName: string;
    userType: string;
    method: string;
    endpoint: string;
    action: IActivityLogAction;
    collectionName: string;
    documentId: mongoose.Types.ObjectId | null;
    oldData: unknown | null;
    newData: unknown | null;
    changedFields: string[];
    requestBody: unknown;
    responseStatus: number;
    ipAddress: string;
    source: IActivityLogSource;
}
