import mongoose, { Schema, model, models } from 'mongoose';
import {
    INotificationTypeEnum,
    INotificationRecipientModelEnum,
    INotificationStatusEnum,
    INotificationAudienceEnum, INotificationCategoryEnum, INotificationPrivacyEnum,
} from '../interfaces/notification.interface';
import type { INotification } from '../interfaces/notification.interface';

export type NotificationDocument = mongoose.Document & INotification;

const notificationSchema = new Schema<NotificationDocument>(
    {
        audience: { type: String, enum: Object.values(INotificationAudienceEnum), default: INotificationAudienceEnum.TARGETED, index: true },
        category: { type: String, enum: Object.values(INotificationCategoryEnum), default: INotificationCategoryEnum.SYSTEM, index: true },
        privacy: { type: String, enum: Object.values(INotificationPrivacyEnum), default: INotificationPrivacyEnum.NORMAL },
        source: { type: new Schema({ domain: { type: String, enum: ['appointment','home_care_request','pharmacy_treatment_request'] }, id: { type: Schema.Types.ObjectId } }, { _id: false }), default: null },
        target: { type: new Schema({ type: { type: String, enum: ['appointment','home_care_request','pharmacy_treatment_request'] }, id: { type: Schema.Types.ObjectId } }, { _id: false }), default: null },
        visible_at: { type: Date, default: Date.now, index: true },
        expires_at: { type: Date, default: () => new Date(Date.now() + 7776000000) },
        dedupe_key: { type: String, trim: true, default: null },
        /**
         * Entities receiving the notification.
         * Resolved dynamically via recipient_model.
         */
        recipient_ids: {
            type: [Schema.Types.ObjectId],
            refPath: 'recipient_model',
            required: false,
            default: [],
        },

        /**
         * Dynamic reference model for recipient_ids.
         * Example: Patient, Doctor, User
         */
        recipient_model: {
            type: String,
            enum: Object.values(INotificationRecipientModelEnum),
            required: true,
        },

        /**
         * Notification category.
         * Example: appointment_confirmed, appointment_reminder
         */
        type: {
            type: String,
            enum: Object.values(INotificationTypeEnum),
            required: true,
            index: true,
        },

        /**
         * Short notification heading displayed to the user.
         */
        title: {
            type: String,
            required: true,
            trim: true,
            maxlength: 255,
        },

        /**
         * Full notification message body.
         */
        body: {
            type: String,
            required: true,
            trim: true,
            maxlength: 2000,
        },

        /**
         * Arbitrary extra payload (e.g. deep-link params, appointment details).
         * Passed through to push notification data field as-is.
         */
        data: {
            type: Schema.Types.Mixed,
            default: null,
        },

        /**
         * Whether the notification has been read.
         */
        is_read: {
            type: Boolean,
            default: false,
            index: true,
        },

        /**
         * Timestamp when the notification was marked as read.
         */
        read_at: {
            type: Date,
            default: null,
        },

        /**
         * Delivery lifecycle state.
         * pending → scheduled (if scheduled_at is set) → sent / failed / cancelled
         */
        status: {
            type: String,
            enum: Object.values(INotificationStatusEnum),
            default: INotificationStatusEnum.PENDING,
            index: true,
        },

        /**
         * When to dispatch the notification.
         * Null means send immediately.
         */
        scheduled_at: {
            type: Date,
            default: null,
            index: true,
        },

        /**
         * Timestamp when the notification was dispatched to the provider.
         */
        sent_at: {
            type: Date,
            default: null,
        },

        /**
         * Error message if delivery failed.
         */
        failed_reason: {
            type: String,
            trim: true,
            default: null,
        },

        /**
         * Optional reference to the related appointment.
         */
        appointment_id: {
            type: Schema.Types.ObjectId,
            ref: 'Appointment',
            default: null,
            index: true,
        },
    },
    {
        timestamps: true,
    }
);

/**
 * Fetch unread notifications for a specific recipient quickly.
 */
notificationSchema.index({ recipient_ids: 1, is_read: 1, createdAt: -1 });

/**
 * Scheduler poll: find pending/scheduled notifications due for dispatch.
 */
notificationSchema.index({ status: 1, scheduled_at: 1 });

/**
 * Fetch all notifications for a recipient in chronological order.
 */
notificationSchema.index({ recipient_ids: 1, createdAt: -1 });
notificationSchema.index({ dedupe_key: 1 }, { unique: true, partialFilterExpression: { dedupe_key: { $type: 'string' } } });
notificationSchema.index({ audience: 1, category: 1, visible_at: 1, createdAt: -1, _id: -1 });

/**
 * Auto-delete notifications after 90 days.
 */
notificationSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export const Notification =
    (models.Notification as mongoose.Model<NotificationDocument>) ||
    model<NotificationDocument>('Notification', notificationSchema);

export default Notification;
