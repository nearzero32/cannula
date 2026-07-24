import Notification, { NotificationDocument } from '../models/notifications.model';
import type { INotification, INotificationRecipientModel } from '../interfaces/notification.interface';
import {
    INotificationRecipientModelEnum,
    INotificationStatusEnum,
} from '../interfaces/notification.interface';
import mongoose, { type PipelineStage } from 'mongoose';
import { oneSignal } from '../lib/onesignal';

class NotificationService {
    private model = Notification;

    // ─── Queries ─────────────────────────────────────────────────────────────

    public async getPaginated({
        main_match,
        additional_pipeline = [],
        projection = null,
        page = 1,
        limit = 10,
    }: {
        main_match: Record<string, unknown>;
        additional_pipeline?: PipelineStage.FacetPipelineStage[];
        projection?: PipelineStage.Project['$project'] | null;
        page?: number;
        limit?: number;
    }): Promise<{ data: NotificationDocument[]; count: number }> {
        const safePage = Math.max(1, page);
        const safeLimit = Math.max(1, limit);
        const skip = (safePage - 1) * safeLimit;

        const pipeline: PipelineStage[] = [
            { $match: main_match },
            {
                $facet: {
                    data: [
                        { $sort: { createdAt: -1 } },
                        { $skip: skip },
                        { $limit: safeLimit },
                        ...additional_pipeline,
                        ...(projection ? [{ $project: projection } as PipelineStage.Project] : []),
                    ],
                    count: [{ $count: 'count' }],
                },
            },
        ];

        const [agg] = await this.model.aggregate(pipeline).exec();
        return {
            data: (agg?.data ?? []) as NotificationDocument[],
            count: agg?.count?.[0]?.count ?? 0,
        };
    }

    public async getById(id: string): Promise<NotificationDocument | null> {
        return this.model.findById(id).exec();
    }

    public async getUnreadCount(
        recipient_id: string,
        recipient_model: INotificationRecipientModel
    ): Promise<number> {
        return this.model.countDocuments({
            recipient_ids: new mongoose.Types.ObjectId(recipient_id),
            recipient_model,
            is_read: false,
        }).exec();
    }

    // ─── Mutations ───────────────────────────────────────────────────────────

    public async create(payload: Partial<INotification>): Promise<NotificationDocument> {
        return this.model.create(payload);
    }

    public async update(
        id: string,
        payload: Partial<INotification>
    ): Promise<NotificationDocument | null> {
        return this.model.findByIdAndUpdate(id, payload, { returnDocument: 'after' }).exec();
    }

    public async markAsRead(id: string): Promise<NotificationDocument | null> {
        return this.update(id, { is_read: true, read_at: new Date() as any });
    }

    public async markAllAsRead(
        recipient_id: string,
        recipient_model: INotificationRecipientModel
    ): Promise<number> {
        const result = await this.model
            .updateMany(
                {
                    recipient_ids: new mongoose.Types.ObjectId(recipient_id),
                    recipient_model,
                    is_read: false,
                },
                { $set: { is_read: true, read_at: new Date() } }
            )
            .exec();
        return result.modifiedCount;
    }

    public async cancel(id: string): Promise<NotificationDocument | null> {
        return this.update(id, { status: INotificationStatusEnum.CANCELLED });
    }

    // ─── Delivery ────────────────────────────────────────────────────────────

    /**
     * Dispatch a saved notification via OneSignal push.
     * Updates the record's status to `sent` or `failed` based on the result.
     */
    public async dispatch(id: string): Promise<NotificationDocument | null> {
        const notification = await this.getById(id);
        if (!notification) return null;

        const result = await oneSignal.sendPush({
            external_ids: notification.recipient_ids.map((id) => id.toString()),
            send_to_all:
                notification.recipient_model === INotificationRecipientModelEnum.ALL,
            title: notification.title,
            body: notification.body,
            data: notification.data as Record<string, unknown> | null,
        });

        if (result.success) {
            return this.update(id, {
                status: INotificationStatusEnum.SENT,
                sent_at: new Date() as any,
            });
        }

        return this.update(id, {
            status: INotificationStatusEnum.FAILED,
            failed_reason: result.error,
        });
    }

    /**
     * Create a notification record and immediately dispatch it.
     * Use this for instant (non-scheduled) notifications.
     */
    public async createAndDispatch(
        payload: Partial<INotification>
    ): Promise<NotificationDocument | null> {
        const notification = await this.create({
            ...payload,
            status: INotificationStatusEnum.PENDING,
            is_read: false,
        });

        return this.dispatch((notification._id as any).toString());
    }

    /**
     * Mark a failed or pending notification as sent (used by manual retry or external dispatcher).
     */
    public async markSent(id: string): Promise<NotificationDocument | null> {
        return this.update(id, {
            status: INotificationStatusEnum.SENT,
            sent_at: new Date() as any,
        });
    }

    /**
     * Record a delivery failure with the provider's error message.
     */
    public async markFailed(id: string, reason: string): Promise<NotificationDocument | null> {
        return this.update(id, {
            status: INotificationStatusEnum.FAILED,
            failed_reason: reason,
        });
    }
}

export default new NotificationService();
