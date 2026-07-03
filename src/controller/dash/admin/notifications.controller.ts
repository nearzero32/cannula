import Elysia, { t } from 'elysia';
import { AuthPlugin } from '../../../middleware/auth.middleware';
import mongoose from 'mongoose';
import notificationService from '../../../services/notification.service';
import {
    INotificationTypeEnum,
    INotificationStatusEnum,
    INotificationRecipientModelEnum,
} from '../../../interfaces/notification.interface';

const ObjectId = mongoose.Types.ObjectId;

export const notificationsController = new Elysia({ prefix: '/notifications' })
    .use(AuthPlugin())

    // List all notifications with filters
    .get(
        '/',
        async ({ query }) => {
            const page = Math.max(1, Number(query.page) || 1);
            const limit = Math.min(100, Math.max(1, Number(query.limit) || 10));

            const main_match: Record<string, unknown> = {};

            if (query.recipient_ids && ObjectId.isValid(query.recipient_ids))
                main_match.recipient_ids = new ObjectId(query.recipient_ids);

            if (query.recipient_model) main_match.recipient_model = query.recipient_model;

            if (query.appointment_id && ObjectId.isValid(query.appointment_id))
                main_match.appointment_id = new ObjectId(query.appointment_id);

            if (query.type) main_match.type = query.type;
            if (query.status) main_match.status = query.status;

            if (query.is_read !== undefined)
                main_match.is_read = query.is_read === 'true';

            if (query.dateFrom || query.dateTo) {
                const dateFilter: Record<string, Date> = {};
                if (query.dateFrom) dateFilter.$gte = new Date(query.dateFrom);
                if (query.dateTo) dateFilter.$lte = new Date(query.dateTo);
                main_match.createdAt = dateFilter;
            }

            if (query.search) {
                main_match.$or = [
                    { title: { $regex: query.search, $options: 'i' } },
                    { body: { $regex: query.search, $options: 'i' } },
                ];
            }

            const { data, count } = await notificationService.getPaginated({
                main_match,
                page,
                limit,
            });
            const totalPages = Math.ceil(count / limit);

            return {
                error: false,
                message: 'تم جلب الإشعارات بنجاح',
                data,
                pagination: {
                    page,
                    limit,
                    total: count,
                    pages: totalPages,
                    hasNext: page < totalPages,
                    hasPrev: page > 1,
                },
            };
        },
        {
            query: t.Object({
                page: t.Optional(t.String()),
                limit: t.Optional(t.String()),
                recipient_ids: t.Optional(t.String()),
                recipient_model: t.Optional(t.Enum(INotificationRecipientModelEnum)),
                appointment_id: t.Optional(t.String()),
                type: t.Optional(t.Enum(INotificationTypeEnum)),
                status: t.Optional(t.Enum(INotificationStatusEnum)),
                is_read: t.Optional(t.Union([t.Literal('true'), t.Literal('false')])),
                dateFrom: t.Optional(t.String()),
                dateTo: t.Optional(t.String()),
                search: t.Optional(t.String()),
            }),
        }
    )

    // Get notification by ID
    .get(
        '/:id',
        async ({ params, set }) => {
            if (!ObjectId.isValid(params.id)) {
                set.status = 400;
                return { error: true, message: 'معرف الإشعار غير صالح' };
            }

            const notification = await notificationService.getById(params.id);
            if (!notification) {
                set.status = 404;
                return { error: true, message: 'الإشعار غير موجود' };
            }

            return { error: false, message: 'تم جلب الإشعار بنجاح', data: notification };
        },
        { params: t.Object({ id: t.String() }) }
    )

    // Create / schedule a notification manually
    .post(
        '/',
        async ({ body, set }) => {
            const invalidRecipient = body.recipient_ids.find((id) => !ObjectId.isValid(id));
            if (invalidRecipient) {
                set.status = 400;
                return { error: true, message: 'معرف مستلم غير صالح' };
            }

            if (body.appointment_id && !ObjectId.isValid(body.appointment_id)) {
                set.status = 400;
                return { error: true, message: 'معرف الموعد غير صالح' };
            }

            const isScheduled = !!body.scheduled_at;

            const payload = {
                recipient_ids: body.recipient_ids.map((id) => new ObjectId(id) as any),
                recipient_model: body.recipient_model,
                type: body.type,
                title: body.title,
                body: body.body,
                data: body.data ?? null,
                appointment_id: body.appointment_id
                    ? (new ObjectId(body.appointment_id) as any)
                    : null,
                scheduled_at: body.scheduled_at ? new Date(body.scheduled_at) : null,
            };

            // Scheduled → save only. Instant → save and dispatch to OneSignal.
            const notification = isScheduled
                ? await notificationService.create({
                    ...payload,
                    status: INotificationStatusEnum.SCHEDULED,
                    is_read: false,
                })
                : await notificationService.createAndDispatch(payload);

            set.status = 201;
            return { error: false, message: 'تم إنشاء الإشعار بنجاح', data: notification };
        },
        {
            body: t.Object({
                recipient_ids: t.Array(t.String({ minLength: 1 }), { minItems: 1 }),
                recipient_model: t.Enum(INotificationRecipientModelEnum),
                type: t.Enum(INotificationTypeEnum),
                title: t.String({ minLength: 1, maxLength: 255 }),
                body: t.String({ minLength: 1, maxLength: 2000 }),
                data: t.Optional(t.Nullable(t.Record(t.String(), t.Unknown()))),
                appointment_id: t.Optional(t.Nullable(t.String())),
                scheduled_at: t.Optional(t.Nullable(t.String())),
            }),
        }
    )

    // Cancel a pending or scheduled notification
    .patch(
        '/:id/cancel',
        async ({ params, set }) => {
            if (!ObjectId.isValid(params.id)) {
                set.status = 400;
                return { error: true, message: 'معرف الإشعار غير صالح' };
            }

            const notification = await notificationService.getById(params.id);
            if (!notification) {
                set.status = 404;
                return { error: true, message: 'الإشعار غير موجود' };
            }

            const cancellable = [
                INotificationStatusEnum.PENDING,
                INotificationStatusEnum.SCHEDULED,
            ];
            if (!cancellable.includes(notification.status as any)) {
                set.status = 422;
                return { error: true, message: 'لا يمكن إلغاء هذا الإشعار في حالته الحالية' };
            }

            const updated = await notificationService.cancel(params.id);
            return { error: false, message: 'تم إلغاء الإشعار بنجاح', data: updated };
        },
        { params: t.Object({ id: t.String() }) }
    );
