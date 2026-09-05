import Elysia, { t } from 'elysia';
import { safeSearchPattern } from '../../../services/search-safety.service';
import { SWAGGER_TAGS } from '../../../constants/swagger-tags';
import { AuthPlugin } from '../../../middleware/auth.middleware';
import mongoose from 'mongoose';
import notificationService from '../../../services/notification.service';
import {
    INotificationTypeEnum,
    INotificationStatusEnum,
    INotificationRecipientModelEnum,
} from '../../../interfaces/notification.interface';
import { BadRequestResponseSchema, GenericDataResponseSchema, GenericPaginatedResponseSchema, NotFoundResponseSchema, ProtectedApiErrorResponses, UnprocessableEntityResponseSchema, ValidationErrorResponseSchema } from '../../../schemas/api-response.schema';
import { AdminPermissionGuardPlugin } from '../../../middleware/authorization.middleware';
import { IAdminPermissionEnum } from '../../../interfaces/admin.interface';
import notificationAnalyticsService from '../../../services/notification-analytics.service';
import notificationDeliveryAdminService from '../../../services/notification-delivery-admin.service';

const ObjectId = mongoose.Types.ObjectId;

export const notificationsController = new Elysia({
    prefix: '/notifications',
    detail: { tags: [SWAGGER_TAGS.ADMIN.NOTIFICATIONS] },
})
    .use(AuthPlugin())
    .use(AdminPermissionGuardPlugin(IAdminPermissionEnum.MANAGE_SETTINGS))
    .get('/:id/analytics',async({params,set})=>{try{return{error:false,message:'تم جلب تحليلات الإشعار بنجاح',data:await notificationAnalyticsService.getSummary(params.id)}}catch(error){if(error instanceof Error&&'status' in error){set.status=(error as any).status;return{error:true,message:error.message}}throw error}},{params:t.Object({id:t.String()}),detail:{summary:'Notification analytics',description:'TARGETED uses NotificationRecipient as denominator. PUBLIC has no known denominator: targeted_count, unread_count, and read_rate are null; only observed unique reads are counted.'},response:{200:GenericDataResponseSchema,400:BadRequestResponseSchema,404:NotFoundResponseSchema,...ProtectedApiErrorResponses}})
    .get('/:id/delivery',async({params,set})=>{try{return{error:false,message:'تم جلب ملخص التسليم بنجاح',data:await notificationDeliveryAdminService.summary(params.id)}}catch(error){if(error instanceof Error&&'status'in error){set.status=(error as any).status;return{error:true,message:error.message}}throw error}},{params:t.Object({id:t.String()}),detail:{summary:'Notification delivery summary',description:'Delivery counts describe push processing, not inbox reads.'},response:{200:GenericDataResponseSchema,400:BadRequestResponseSchema,404:NotFoundResponseSchema,...ProtectedApiErrorResponses}})
    .get('/:id/deliveries',async({params,query,set})=>{try{const r=await notificationDeliveryAdminService.list(params.id,{page:Number(query.page)||1,limit:Number(query.limit)||20,status:query.status});return{error:false,message:'تم جلب عمليات التسليم بنجاح',data:r.data,pagination:{page:r.page,limit:r.limit,total:r.total,pages:Math.ceil(r.total/r.limit),hasNext:r.page*r.limit<r.total,hasPrev:r.page>1}}}catch(error){if(error instanceof Error&&'status'in error){set.status=(error as any).status;return{error:true,message:error.message}}throw error}},{params:t.Object({id:t.String()}),query:t.Object({page:t.Optional(t.String()),limit:t.Optional(t.String()),status:t.Optional(t.Union([t.Literal('pending'),t.Literal('processing'),t.Literal('delivered'),t.Literal('failed'),t.Literal('dead'),t.Literal('cancelled')]))}),detail:{summary:'Notification deliveries',description:'Paginated delivery operations. Ownership and provider secrets are never returned.'},response:{200:GenericPaginatedResponseSchema,400:BadRequestResponseSchema,404:NotFoundResponseSchema,...ProtectedApiErrorResponses}})
    .post('/:notificationId/deliveries/:deliveryId/retry',async({params,set})=>{try{return{error:false,message:'تمت جدولة إعادة المحاولة بنجاح',data:await notificationDeliveryAdminService.retry(params.notificationId,params.deliveryId)}}catch(error){if(error instanceof Error&&'status'in error){set.status=(error as any).status;return{error:true,message:error.message}}throw error}},{params:t.Object({notificationId:t.String(),deliveryId:t.String()}),detail:{summary:'Retry failed notification delivery',description:'Only FAILED or DEAD deliveries can be reset to PENDING. Delivered, cancelled, processing, and cancelled-parent deliveries return 409.'},response:{200:GenericDataResponseSchema,400:BadRequestResponseSchema,404:NotFoundResponseSchema,409:UnprocessableEntityResponseSchema,...ProtectedApiErrorResponses}})

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
                const search = safeSearchPattern(query.search);
                main_match.$or = [
                    { title: { $regex: search, $options: 'i' } },
                    { body: { $regex: search, $options: 'i' } },
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
            response: { 200: GenericPaginatedResponseSchema, 422: ValidationErrorResponseSchema, ...ProtectedApiErrorResponses },
        }
    )

    .get('/:id/readers',async({params,query,set})=>{try{const r=await notificationAnalyticsService.readers(params.id,{page:Number(query.page)||1,limit:Number(query.limit)||20,reader_type:query.reader_type});return{error:false,message:'تم جلب القراء بنجاح',data:r.data,pagination:{page:Number(query.page)||1,limit:Math.min(100,Math.max(1,Number(query.limit)||20)),total:r.total,pages:Math.ceil(r.total/(Math.min(100,Math.max(1,Number(query.limit)||20)))),hasNext:false,hasPrev:false}}}catch(e){if(e instanceof Error&&'status'in e){set.status=(e as any).status;return{error:true,message:e.message}}throw e}},{params:t.Object({id:t.String()}),query:t.Object({page:t.Optional(t.String()),limit:t.Optional(t.String()),reader_type:t.Optional(t.Union([t.Literal('user'),t.Literal('installation')]))}),detail:{summary:'Notification readers',description:'Installation readers are anonymous; no installation identifier is exposed.'},response:{200:GenericPaginatedResponseSchema,400:BadRequestResponseSchema,404:NotFoundResponseSchema,...ProtectedApiErrorResponses}})
    .get('/:id/recipients',async({params,query,set})=>{try{const r=await notificationAnalyticsService.recipients(params.id,{page:Number(query.page)||1,limit:Number(query.limit)||20});return{error:false,message:'تم جلب المستلمين بنجاح',data:r.data,pagination:{page:Number(query.page)||1,limit:Math.min(100,Math.max(1,Number(query.limit)||20)),total:r.total,pages:Math.ceil(r.total/(Math.min(100,Math.max(1,Number(query.limit)||20)))),hasNext:false,hasPrev:false}}}catch(e){if(e instanceof Error&&'status'in e){set.status=(e as any).status;return{error:true,message:e.message}}throw e}},{params:t.Object({id:t.String()}),query:t.Object({page:t.Optional(t.String()),limit:t.Optional(t.String())}),detail:{summary:'Targeted notification recipients'},response:{200:GenericPaginatedResponseSchema,400:BadRequestResponseSchema,404:NotFoundResponseSchema,409:UnprocessableEntityResponseSchema,...ProtectedApiErrorResponses}})
    .get('/:id/unread-recipients',async({params,query,set})=>{try{const r=await notificationAnalyticsService.recipients(params.id,{page:Number(query.page)||1,limit:Number(query.limit)||20,unread:true});return{error:false,message:'تم جلب المستلمين غير المقروءين بنجاح',data:r.data,pagination:{page:Number(query.page)||1,limit:Math.min(100,Math.max(1,Number(query.limit)||20)),total:r.total,pages:Math.ceil(r.total/(Math.min(100,Math.max(1,Number(query.limit)||20)))),hasNext:false,hasPrev:false}}}catch(e){if(e instanceof Error&&'status'in e){set.status=(e as any).status;return{error:true,message:e.message}}throw e}},{params:t.Object({id:t.String()}),query:t.Object({page:t.Optional(t.String()),limit:t.Optional(t.String())}),detail:{summary:'Unread targeted notification recipients',description:'Unavailable for PUBLIC notifications because no recipient denominator exists.'},response:{200:GenericPaginatedResponseSchema,400:BadRequestResponseSchema,404:NotFoundResponseSchema,409:UnprocessableEntityResponseSchema,...ProtectedApiErrorResponses}})
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
        {
            params: t.Object({ id: t.String() }),
            response: { 200: GenericDataResponseSchema, 400: BadRequestResponseSchema, 404: NotFoundResponseSchema, ...ProtectedApiErrorResponses },
        }
    )

    // Create / schedule a notification manually
    .post(
        '/',
        async ({ body, set }) => {
            const isBroadcast =
                body.recipient_model === INotificationRecipientModelEnum.ALL;

            if (!isBroadcast && body.recipient_ids.length === 0) {
                set.status = 400;
                return { error: true, message: 'يجب تحديد مستلم واحد على الأقل' };
            }

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
                recipient_ids: isBroadcast
                    ? []
                    : body.recipient_ids.map((id) => new ObjectId(id) as any),
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

            // New-core public/User notifications enqueue durable work immediately;
            // legacy profile-ID schedules retain their compatibility behavior.
            const notification = isScheduled && !isBroadcast && body.recipient_model !== INotificationRecipientModelEnum.USER
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
                recipient_ids: t.Array(t.String({ minLength: 1 })),
                recipient_model: t.Enum(INotificationRecipientModelEnum),
                type: t.Enum(INotificationTypeEnum),
                title: t.String({ minLength: 1, maxLength: 255 }),
                body: t.String({ minLength: 1, maxLength: 2000 }),
                data: t.Optional(t.Nullable(t.Record(t.String(), t.Unknown()))),
                appointment_id: t.Optional(t.Nullable(t.String())),
                scheduled_at: t.Optional(t.Nullable(t.String())),
            }),
            response: { 201: GenericDataResponseSchema, 400: BadRequestResponseSchema, 422: ValidationErrorResponseSchema, ...ProtectedApiErrorResponses },
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
        {
            params: t.Object({ id: t.String() }),
            response: {
                200: GenericDataResponseSchema, 400: BadRequestResponseSchema, 404: NotFoundResponseSchema,
                422: UnprocessableEntityResponseSchema, ...ProtectedApiErrorResponses,
            },
        }
    );
