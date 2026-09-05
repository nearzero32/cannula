import mongoose, { Schema, model, models } from 'mongoose';

export interface INotificationRecipient {
    notification_id: mongoose.Types.ObjectId;
    user_id: mongoose.Types.ObjectId;
    expires_at: Date;
    createdAt: Date;
}

const schema = new Schema<INotificationRecipient>({
    notification_id: { type: Schema.Types.ObjectId, ref: 'Notification', required: true },
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    expires_at: { type: Date, required: true },
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false });
schema.index({ notification_id: 1, user_id: 1 }, { unique: true });
schema.index({ user_id: 1, notification_id: 1 });
schema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export const NotificationRecipient = (models.NotificationRecipient as mongoose.Model<INotificationRecipient>) || model<INotificationRecipient>('NotificationRecipient', schema);
export default NotificationRecipient;
