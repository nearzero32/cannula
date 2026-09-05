import Notification, { NotificationDocument } from '../models/notifications.model';
import type { INotification, INotificationRecipientModel } from '../interfaces/notification.interface';
import {
    INotificationRecipientModelEnum,
    INotificationStatusEnum,
} from '../interfaces/notification.interface';
import mongoose, { type PipelineStage } from 'mongoose';
import { oneSignal } from '../lib/onesignal';
import NotificationRecipient from '../models/notification-recipient.model';
import NotificationRead, { INotificationReaderTypeEnum } from '../models/notification-read.model';
import { INotificationAudienceEnum, INotificationCategoryEnum, INotificationPrivacyEnum } from '../interfaces/notification.interface';
import notificationDeliveryService from './notification-delivery.service';
import NotificationDelivery from '../models/notification-delivery.model';
import { INotificationDeliveryStatusEnum } from '../interfaces/notification-delivery.interface';

export type NotificationViewer = { userId: string } | { installationHash: string };
export const NOTIFICATION_READ_ALL_BATCH_SIZE = 500;
export type MobileNotificationInput = {
    category: typeof INotificationCategoryEnum[keyof typeof INotificationCategoryEnum]; type: INotification['type']; title: string; body: string;
    privacy?: typeof INotificationPrivacyEnum[keyof typeof INotificationPrivacyEnum]; source?: { domain: 'appointment'; id: mongoose.Types.ObjectId } | null;
    target?: { type: 'appointment'; id: mongoose.Types.ObjectId } | null; visible_at?: Date; expires_at?: Date; dedupe_key?: string;
};

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
        const safeLimit = Math.min(100, Math.max(1, limit));
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

    /** New content API. Public notifications deliberately have no recipient rows. */
    public async createPublic(input: MobileNotificationInput): Promise<NotificationDocument> {
        const notification=await this.create({ ...input, audience: INotificationAudienceEnum.PUBLIC, recipient_ids: [], recipient_model: INotificationRecipientModelEnum.ALL, status: INotificationStatusEnum.PENDING, is_read: false, visible_at: input.visible_at ?? new Date(), expires_at: input.expires_at ?? new Date(Date.now() + 7776000000) });await notificationDeliveryService.enqueueForNotification(notification);return notification;
    }

    /** Creates content and User-id recipients atomically; it never dispatches push. */
    public async createTargeted(input: MobileNotificationInput, userIds: readonly (string | mongoose.Types.ObjectId)[]): Promise<NotificationDocument> {
        const uniqueUserIds = [...new Set(userIds.map(String))];
        if (!uniqueUserIds.length) throw new Error('Targeted notifications require at least one User recipient');
        if (uniqueUserIds.some((id) => !mongoose.Types.ObjectId.isValid(id))) throw new Error('Invalid User recipient');
        const session = await mongoose.startSession();
        try {
            let notification!: NotificationDocument;
            await session.withTransaction(async () => {
                const expires = input.expires_at ?? new Date(Date.now() + 7776000000);
                const created = await this.model.create([{ ...input, audience: INotificationAudienceEnum.TARGETED, recipient_ids: [], recipient_model: INotificationRecipientModelEnum.USER, status: INotificationStatusEnum.PENDING, is_read: false, visible_at: input.visible_at ?? new Date(), expires_at: expires }], { session });
                notification = created[0]!;
                await NotificationRecipient.insertMany(uniqueUserIds.map((user_id) => ({ notification_id: notification._id, user_id: new mongoose.Types.ObjectId(user_id), expires_at: expires })), { session, ordered: true });
                await notificationDeliveryService.enqueueForNotification(notification,session);
            });
            return notification;
        } finally { await session.endSession(); }
    }

    public async createTargetedOnce(input: MobileNotificationInput, userIds: readonly (string | mongoose.Types.ObjectId)[]): Promise<{ notification: NotificationDocument; created: boolean }> {
        if (!input.dedupe_key) return { notification: await this.createTargeted(input, userIds), created: true };
        try { return { notification: await this.createTargeted(input, userIds), created: true }; }
        catch (error: any) {
            if (error?.code !== 11000) throw error;
            const notification = await this.model.findOne({ dedupe_key: input.dedupe_key }).exec();
            if (!notification) throw error;
            return { notification, created: false };
        }
    }

    private visibleMatch(now: Date, category?: string): Record<string, unknown> {
        const match: Record<string, unknown> = { visible_at: { $lte: now }, expires_at: { $gt: now }, status: { $ne: INotificationStatusEnum.CANCELLED } };
        if (category && category !== 'all') match.category = category;
        return match;
    }

    /** Returns an aggregation whose output is exactly the visible feed, never an in-process ID list. */
    private visiblePipeline(viewer: NotificationViewer, now: Date, category?: string): PipelineStage[] {
        const visible = this.visibleMatch(now, category);
        if ('installationHash' in viewer) return [{ $match: { ...visible, audience: INotificationAudienceEnum.PUBLIC } }];
        const userId = new mongoose.Types.ObjectId(viewer.userId);
        return [
            { $match: { ...visible, audience: INotificationAudienceEnum.PUBLIC } },
            { $unionWith: { coll: NotificationRecipient.collection.name, pipeline: [
                { $match: { user_id: userId } },
                { $lookup: { from: Notification.collection.name, localField: 'notification_id', foreignField: '_id', as: 'notification' } },
                { $unwind: '$notification' }, { $replaceRoot: { newRoot: '$notification' } },
                { $match: { ...visible, audience: INotificationAudienceEnum.TARGETED } },
            ] } },
        ];
    }

    private readLookup(viewer: NotificationViewer): PipelineStage.Lookup {
        const identity = 'userId' in viewer
            ? [{ $eq: ['$user_id', new mongoose.Types.ObjectId(viewer.userId)] }]
            : [{ $eq: ['$installation_key_hash', viewer.installationHash] }];
        const readerType = 'userId' in viewer ? INotificationReaderTypeEnum.USER : INotificationReaderTypeEnum.INSTALLATION;
        return { $lookup: { from: NotificationRead.collection.name, let: { notificationId: '$_id' }, pipeline: [{ $match: { $expr: { $and: [{ $eq: ['$notification_id', '$$notificationId'] }, { $eq: ['$reader_type', readerType] }, ...identity] } } }, { $limit: 1 }], as: '_read' } } as PipelineStage.Lookup;
    }

    public async getMobileInbox(viewer: NotificationViewer, options: { page: number; limit: number; category?: string }) {
        const now = new Date(), skip = (options.page - 1) * options.limit;
        const result = await this.model.aggregate([
            ...this.visiblePipeline(viewer, now, options.category), { $sort: { createdAt: -1, _id: -1 } },
            { $facet: { data: [{ $skip: skip }, { $limit: options.limit }, this.readLookup(viewer), { $project: { category: 1, type: 1, title: 1, body: 1, target: 1, privacy: 1, createdAt: 1, is_read: { $gt: [{ $size: '$_read' }, 0] }, read_at: { $ifNull: [{ $arrayElemAt: ['$_read.read_at', 0] }, null] } } }], count: [{ $count: 'total' }] } },
        ]).exec();
        const aggregate = result[0] ?? { data: [], count: [] };
        const unread_count = await this.unreadCount(viewer, now);
        return { data: aggregate.data, total: aggregate.count[0]?.total ?? 0, unread_count };
    }

    public async unreadCount(viewer: NotificationViewer, now = new Date()): Promise<number> {
        const result = await this.model.aggregate([
            ...this.visiblePipeline(viewer, now), this.readLookup(viewer), { $match: { '_read.0': { $exists: false } } }, { $count: 'total' },
        ]).exec();
        return result[0]?.total ?? 0;
    }

    private async findVisibleNotification(viewer: NotificationViewer, id: mongoose.Types.ObjectId, now: Date) {
        const visible = this.visibleMatch(now);
        if ('installationHash' in viewer) return this.model.findOne({ _id: id, ...visible, audience: INotificationAudienceEnum.PUBLIC }).select('expires_at').lean().exec();
        return this.model.aggregate([...this.visiblePipeline(viewer, now), { $match: { _id: id } }, { $limit: 1 }, { $project: { expires_at: 1 } }]).exec().then((rows) => rows[0] ?? null);
    }

    public async markRead(viewer: NotificationViewer, notificationId: string): Promise<boolean> {
        if (!mongoose.Types.ObjectId.isValid(notificationId)) return false;
        const id = new mongoose.Types.ObjectId(notificationId), notification = await this.findVisibleNotification(viewer, id, new Date());
        if (!notification) return false;
        const identity = 'userId' in viewer ? { reader_type: INotificationReaderTypeEnum.USER, user_id: new mongoose.Types.ObjectId(viewer.userId), installation_key_hash: null } : { reader_type: INotificationReaderTypeEnum.INSTALLATION, user_id: null, installation_key_hash: viewer.installationHash };
        await NotificationRead.updateOne({ notification_id: id, reader_type: identity.reader_type, ...(identity.user_id ? { user_id: identity.user_id } : { installation_key_hash: identity.installation_key_hash }) }, { $setOnInsert: { ...identity, notification_id: id, read_at: new Date(), expires_at: notification.expires_at } }, { upsert: true }).exec();
        return true;
    }

    public async markAllRead(viewer: NotificationViewer, cutoff = new Date()): Promise<number> {
        const identity = 'userId' in viewer ? { reader_type: INotificationReaderTypeEnum.USER, user_id: new mongoose.Types.ObjectId(viewer.userId), installation_key_hash: null } : { reader_type: INotificationReaderTypeEnum.INSTALLATION, user_id: null, installation_key_hash: viewer.installationHash };
        const cursor = this.model.aggregate([
            ...this.visiblePipeline(viewer, cutoff), { $match: { createdAt: { $lte: cutoff } } }, this.readLookup(viewer), { $match: { '_read.0': { $exists: false } } }, { $project: { _id: 1, expires_at: 1 } },
        ]).cursor({ batchSize: NOTIFICATION_READ_ALL_BATCH_SIZE });
        let marked = 0, batch: Array<{ _id: mongoose.Types.ObjectId; expires_at: Date }> = [];
        const flush = async () => {
            if (!batch.length) return;
            const result = await NotificationRead.bulkWrite(batch.map((notification) => ({ updateOne: { filter: { notification_id: notification._id, reader_type: identity.reader_type, ...(identity.user_id ? { user_id: identity.user_id } : { installation_key_hash: identity.installation_key_hash }) }, update: { $setOnInsert: { ...identity, notification_id: notification._id, read_at: cutoff, expires_at: notification.expires_at } }, upsert: true } })), { ordered: false });
            marked += result.upsertedCount; batch = [];
        };
        for await (const notification of cursor as AsyncIterable<{ _id: mongoose.Types.ObjectId; expires_at: Date }>) { batch.push(notification); if (batch.length === NOTIFICATION_READ_ALL_BATCH_SIZE) await flush(); }
        await flush();
        return marked;
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
        const notification = await this.update(id, { status: INotificationStatusEnum.CANCELLED });
        if (notification) await NotificationDelivery.updateMany({ notification_id: notification._id, status: { $in: [INotificationDeliveryStatusEnum.PENDING, INotificationDeliveryStatusEnum.FAILED] } }, { $set: { status: INotificationDeliveryStatusEnum.CANCELLED, next_attempt_at: null, lease_expires_at: null, processing_started_at: null } }).exec();
        return notification;
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

    public async createAndDispatchOnce(payload: Partial<INotification>, dedupeKey: string): Promise<NotificationDocument | null> {
        const { notification, created } = await this.createOnce(payload, dedupeKey);
        return created ? this.dispatch(String(notification._id)) : notification;
    }

    public async createOnce(payload: Partial<INotification>, dedupeKey: string): Promise<{ notification: NotificationDocument; created: boolean }> {
        try {
            const notification = await this.create({ ...payload, dedupe_key: dedupeKey, status: INotificationStatusEnum.PENDING, is_read: false });
            return { notification, created: true };
        } catch (error: unknown) {
            if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
                const notification = await this.model.findOne({ dedupe_key: dedupeKey }).exec();
                if (notification) return { notification, created: false };
            }
            throw error;
        }
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
