import mongoose, { Schema, model, models } from 'mongoose';

export const INotificationReaderTypeEnum = { USER: 'user', INSTALLATION: 'installation' } as const;
export type INotificationReaderType = (typeof INotificationReaderTypeEnum)[keyof typeof INotificationReaderTypeEnum];

export interface INotificationRead {
    notification_id: mongoose.Types.ObjectId;
    reader_type: INotificationReaderType;
    user_id: mongoose.Types.ObjectId | null;
    installation_key_hash: string | null;
    read_at: Date;
    expires_at: Date;
    createdAt: Date;
}

const schema = new Schema<INotificationRead>({
    notification_id: { type: Schema.Types.ObjectId, ref: 'Notification', required: true },
    reader_type: { type: String, enum: Object.values(INotificationReaderTypeEnum), required: true },
    user_id: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    installation_key_hash: { type: String, default: null, select: false },
    read_at: { type: Date, required: true, default: Date.now },
    expires_at: { type: Date, required: true },
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false });
schema.pre('validate', function () {
    const isUser = this.reader_type === INotificationReaderTypeEnum.USER;
    if (isUser ? (!this.user_id || this.installation_key_hash) : (!this.installation_key_hash || this.user_id)) {
        this.invalidate('reader_type', 'Read identity must contain exactly one matching reader key');
    }
});
schema.index({ notification_id: 1, user_id: 1 }, { unique: true, partialFilterExpression: { reader_type: INotificationReaderTypeEnum.USER } });
schema.index({ notification_id: 1, installation_key_hash: 1 }, { unique: true, partialFilterExpression: { reader_type: INotificationReaderTypeEnum.INSTALLATION } });
schema.index({ user_id: 1, notification_id: 1 }, { partialFilterExpression: { reader_type: INotificationReaderTypeEnum.USER } });
schema.index({ installation_key_hash: 1, notification_id: 1 }, { partialFilterExpression: { reader_type: INotificationReaderTypeEnum.INSTALLATION } });
schema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export const NotificationRead = (models.NotificationRead as mongoose.Model<INotificationRead>) || model<INotificationRead>('NotificationRead', schema);
export default NotificationRead;
