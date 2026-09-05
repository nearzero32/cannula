import mongoose from 'mongoose';
import Notification from '../models/notifications.model';
import NotificationDelivery from '../models/notification-delivery.model';
import { INotificationStatusEnum } from '../interfaces/notification.interface';
import { INotificationDeliveryStatusEnum as S } from '../interfaces/notification-delivery.interface';
import { DomainError } from './domain-error';

class NotificationDeliveryAdminService {
    private async requireNotification(id: string) {
        if (!mongoose.Types.ObjectId.isValid(id)) throw new DomainError('معرف الإشعار غير صالح', 400);
        const notification = await Notification.findById(id).select('audience status').lean().exec();
        if (!notification) throw new DomainError('الإشعار غير موجود', 404);
        return notification;
    }

    async summary(notificationId: string) {
        const notification = await this.requireNotification(notificationId);
        const id = new mongoose.Types.ObjectId(notificationId);
        const [row] = await NotificationDelivery.aggregate([{ $match: { notification_id: id } }, { $group: { _id: null, total_deliveries: { $sum: 1 }, pending_count: { $sum: { $cond: [{ $eq: ['$status', S.PENDING] }, 1, 0] } }, processing_count: { $sum: { $cond: [{ $eq: ['$status', S.PROCESSING] }, 1, 0] } }, delivered_count: { $sum: { $cond: [{ $eq: ['$status', S.DELIVERED] }, 1, 0] } }, failed_count: { $sum: { $cond: [{ $eq: ['$status', S.FAILED] }, 1, 0] } }, dead_count: { $sum: { $cond: [{ $eq: ['$status', S.DEAD] }, 1, 0] } }, cancelled_count: { $sum: { $cond: [{ $eq: ['$status', S.CANCELLED] }, 1, 0] } }, last_delivery_at: { $max: '$delivered_at' }, next_retry_at: { $min: { $cond: [{ $eq: ['$status', S.FAILED] }, '$next_attempt_at', null] } } } }]).exec();
        return { notification_id: notificationId, audience: notification.audience, total_deliveries: row?.total_deliveries ?? 0, pending_count: row?.pending_count ?? 0, processing_count: row?.processing_count ?? 0, delivered_count: row?.delivered_count ?? 0, failed_count: row?.failed_count ?? 0, dead_count: row?.dead_count ?? 0, cancelled_count: row?.cancelled_count ?? 0, last_delivery_at: row?.last_delivery_at ?? null, next_retry_at: row?.next_retry_at ?? null };
    }

    async list(notificationId: string, options: { page?: number; limit?: number; status?: string } = {}) {
        await this.requireNotification(notificationId);
        const id = new mongoose.Types.ObjectId(notificationId), limit = Math.min(100, Math.max(1, options.limit ?? 20)), page = Math.max(1, options.page ?? 1), match: any = { notification_id: id };
        if (options.status) match.status = options.status;
        const [result] = await NotificationDelivery.aggregate([{ $match: match }, { $sort: { createdAt: -1, _id: -1 } }, { $facet: { data: [{ $skip: (page - 1) * limit }, { $limit: limit }, { $lookup: { from: 'users', localField: 'user_id', foreignField: '_id', as: '_user' } }, { $project: { _id: 0, delivery_id: '$_id', recipient_type: 1, user: { $cond: [{ $eq: ['$recipient_type', 'user'] }, { $let: { vars: { u: { $arrayElemAt: ['$_user', 0] } }, in: { _id: '$$u._id', full_name: '$$u.full_name', phone: '$$u.phone' } } }, null] }, status: 1, attempt_count: 1, last_attempt_at: 1, delivered_at: 1, next_attempt_at: 1, last_error_code: 1, provider_message_id: 1 } }], count: [{ $count: 'total' }] } }]).exec();
        return { data: result?.data ?? [], total: result?.count?.[0]?.total ?? 0, page, limit };
    }

    async retry(notificationId: string, deliveryId: string) {
        const notification = await this.requireNotification(notificationId);
        if (notification.status === INotificationStatusEnum.CANCELLED) throw new DomainError('لا يمكن إعادة محاولة إشعار ملغى', 409);
        if (!mongoose.Types.ObjectId.isValid(deliveryId)) throw new DomainError('معرف التسليم غير صالح', 400);
        const row = await NotificationDelivery.findOne({ _id: deliveryId, notification_id: notificationId }).lean().exec();
        if (!row) throw new DomainError('التسليم غير موجود', 404);
        if (row.status !== S.FAILED && row.status !== S.DEAD) throw new DomainError('لا يمكن إعادة محاولة التسليم في حالته الحالية', 409);
        return NotificationDelivery.findOneAndUpdate({ _id: row._id, notification_id: notificationId, status: { $in: [S.FAILED, S.DEAD] } }, { $set: { status: S.PENDING, next_attempt_at: new Date(), claim_token: null, lease_expires_at: null, processing_started_at: null } }, { new: true }).lean().exec();
    }
}

export default new NotificationDeliveryAdminService();
