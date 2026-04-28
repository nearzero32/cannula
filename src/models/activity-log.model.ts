import mongoose, { Schema, model, models } from 'mongoose';
import type { IActivityLog } from '../interfaces/activity-log.interface';
import { IActivityLogActionEnum, IActivityLogSourceEnum } from '../interfaces/activity-log.interface';

export type ActivityLogDocument = mongoose.Document & IActivityLog;

const activityLogSchema = new Schema<ActivityLogDocument>(
    {
        user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        user_name: { type: String, default: 'unknown' },
        user_type: { type: String, default: '' },
        method: { type: String, required: true },
        endpoint: { type: String, required: true },
        action: {
            type: String,
            enum: Object.values(IActivityLogActionEnum),
            required: true,
        },
        collection_name: { type: String, default: '' },
        document_id: { type: Schema.Types.ObjectId, default: null },
        old_data: { type: Schema.Types.Mixed, default: null },
        new_data: { type: Schema.Types.Mixed, default: null },
        changed_fields: [{ type: String }],
        request_body: { type: Schema.Types.Mixed, default: {} },
        response_status: { type: Number, default: 200 },
        ip_address: { type: String, default: '' },
        source: {
            type: String,
            enum: Object.values(IActivityLogSourceEnum),
            default: IActivityLogSourceEnum.DASHBOARD,
        },
    },
    { timestamps: true, versionKey: false }
);

activityLogSchema.index({ source: 1, createdAt: -1 });
activityLogSchema.index({ source: 1, user_id: 1, createdAt: -1 });
activityLogSchema.index({ collection_name: 1, createdAt: -1 });
activityLogSchema.index({ document_id: 1 });
activityLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7776000 }); // 90-day TTL

export const ActivityLog =
    (models.ActivityLog as mongoose.Model<ActivityLogDocument>) ||
    model<ActivityLogDocument>('ActivityLog', activityLogSchema);

export default ActivityLog;
