import mongoose, { Schema, model, models } from 'mongoose';
import type { IActivityLog } from '../interfaces/activity-log.interface';
import { IActivityLogActionEnum, IActivityLogSourceEnum } from '../interfaces/activity-log.interface';

export type ActivityLogDocument = mongoose.Document & IActivityLog;

const activityLogSchema = new Schema<ActivityLogDocument>(
    {
        centerId: { type: Schema.Types.ObjectId, ref: 'Clinic', default: null },
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        userName: { type: String, default: 'unknown' },
        userType: { type: String, default: '' },
        method: { type: String, required: true },
        endpoint: { type: String, required: true },
        action: {
            type: String,
            enum: Object.values(IActivityLogActionEnum),
            required: true,
        },
        collectionName: { type: String, default: '' },
        documentId: { type: Schema.Types.ObjectId, default: null },
        oldData: { type: Schema.Types.Mixed, default: null },
        newData: { type: Schema.Types.Mixed, default: null },
        changedFields: [{ type: String }],
        requestBody: { type: Schema.Types.Mixed, default: {} },
        responseStatus: { type: Number, default: 200 },
        ipAddress: { type: String, default: '' },
        source: {
            type: String,
            enum: Object.values(IActivityLogSourceEnum),
            default: IActivityLogSourceEnum.DASHBOARD,
        },
    },
    { timestamps: true, versionKey: false }
);

activityLogSchema.index({ centerId: 1, source: 1, createdAt: -1 });
activityLogSchema.index({ centerId: 1, source: 1, userId: 1, createdAt: -1 });
activityLogSchema.index({ centerId: 1, collectionName: 1, createdAt: -1 });
activityLogSchema.index({ documentId: 1 });
activityLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7776000 }); // 90-day TTL

export const ActivityLog =
    (models.ActivityLog as mongoose.Model<ActivityLogDocument>) ||
    model<ActivityLogDocument>('ActivityLog', activityLogSchema);

export default ActivityLog;
