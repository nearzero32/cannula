import Elysia, { t } from 'elysia';
import mongoose from 'mongoose';
import { SWAGGER_TAGS } from '../../../constants/swagger-tags';
import { AuthPlugin } from '../../../middleware/auth.middleware';
import homeCarePolicyService from '../../../services/home-care-policy.service';
import homeCareRequestService from '../../../services/home-care-request.service';
import homeCareDispatchService from '../../../services/home-care-dispatch.service';
import homeCareRequestHistoryService from '../../../services/home-care-request-history.service';
import { formatHomeCareRequestForDashboard } from '../../../services/home-care-request.formatter';
import { DomainError } from '../../../services/domain-error';
import { IHomeCareRequestStatusEnum } from '../../../interfaces/home-care-request.interface';
import type { IUserRole } from '../../../interfaces/user.interface';
import {
    BadRequestResponseSchema,
    ConflictResponseSchema,
    ForbiddenResponseSchema,
    NotFoundResponseSchema,
    ProtectedApiErrorResponses,
    UnprocessableEntityResponseSchema,
    ValidationErrorResponseSchema,
} from '../../../schemas/api-response.schema';
import {
    DashboardHomeCareRequestListResponseSchema,
    DashboardHomeCareRequestResponseSchema,
} from '../../../schemas/home-care-request-response.schema';
import { HomeCareHistoryListResponseSchema } from '../../../schemas/nurse-response.schema';
import { AdminPermissionGuardPlugin } from '../../../middleware/authorization.middleware';
import { IAdminPermissionEnum } from '../../../interfaces/admin.interface';

function pagination(page: number, limit: number, total: number) {
    const pages = Math.ceil(total / limit);
    return { page, limit, total, pages, hasNext: page < pages, hasPrev: page > 1 };
}

async function requireOperationalAccess(userId: string, role: IUserRole) {
    const access = await homeCarePolicyService.getAccess(userId, role);
    if (access === 'none') throw new DomainError('غير مصرح لك بإدارة طلبات الرعاية المنزلية', 403);
}

function adminActor(userId: string, endpoint: string) {
    return {
        user_id: userId,
        user_name: `admin_${userId}`,
        user_type: 'admin' as const,
        endpoint,
        source: 'dashboard' as const,
    };
}

function dispatchActor(userId: string, endpoint: string) {
    return { user_id: userId, user_type: 'admin' as const, endpoint };
}

function historyId(value: unknown): string | null {
    if (!value) return null;
    if (typeof value === 'object' && '_id' in value) return String((value as { _id: unknown })._id);
    return String(value);
}

function formatHistory(item: any) {
    return {
        _id: String(item._id), request_id: String(item.request_id), request_number: item.request_number,
        event_type: item.event_type,
        actor: { type: item.actor.type, user_id: historyId(item.actor.user_id), nurse_id: historyId(item.actor.nurse_id) },
        from_status: item.from_status ?? null, to_status: item.to_status ?? null,
        from_nurse_id: historyId(item.from_nurse_id), to_nurse_id: historyId(item.to_nurse_id),
        dispatch_mode: item.dispatch_mode ?? null, reason: item.reason ?? null,
        createdAt: new Date(item.createdAt).toISOString(),
    };
}

export const homeCareRequestsAdminController = new Elysia({
    prefix: '/requests',
    detail: { tags: [SWAGGER_TAGS.ADMIN.HOME_CARE] },
})
    .use(AuthPlugin())
    .use(AdminPermissionGuardPlugin(IAdminPermissionEnum.MANAGE_HOME_CARE))
    .onError(({ code, error, set }) => {
        if (error instanceof DomainError) {
            set.status = error.status;
            return { error: true, message: error.message };
        }
        if (code === 'PARSE') {
            set.status = 400;
            return { error: true, message: 'صيغة البيانات المرسلة غير صحيحة' };
        }
        if (code === 'UNKNOWN' || code === 'INTERNAL_SERVER_ERROR') {
            set.status = 500;
            return { error: true, message: 'حدث خطأ في الخادم' };
        }
    })
    .get('/', async ({ query, phrase }) => {
        await requireOperationalAccess(phrase._id, phrase.role);
        const page = Math.max(1, Number(query.page) || 1);
        const limit = Math.min(100, Math.max(1, Number(query.limit) || 10));
        const { data, count } = await homeCareRequestService.listForDashboard({
            page,
            limit,
            status: query.status,
            service_id: query.service_id,
            category_id: query.category_id,
            patient_id: query.patient_id,
            dateFrom: query.dateFrom,
            dateTo: query.dateTo,
            search: query.search,
        });
        return {
            error: false,
            message: 'تم جلب طلبات الرعاية المنزلية بنجاح',
            data: data.map(formatHomeCareRequestForDashboard),
            pagination: pagination(page, limit, count),
        };
    }, {
        query: t.Object({
            page: t.Optional(t.String()),
            limit: t.Optional(t.String()),
            status: t.Optional(t.Enum(IHomeCareRequestStatusEnum)),
            service_id: t.Optional(t.String()),
            category_id: t.Optional(t.String()),
            patient_id: t.Optional(t.String()),
            dateFrom: t.Optional(t.String({ format: 'date' })),
            dateTo: t.Optional(t.String({ format: 'date' })),
            search: t.Optional(t.String()),
        }),
        response: {
            200: DashboardHomeCareRequestListResponseSchema,
            400: BadRequestResponseSchema,
            403: ForbiddenResponseSchema,
            422: ValidationErrorResponseSchema,
            ...ProtectedApiErrorResponses,
        },
    })
    .get('/:id', async ({ params, phrase, set }) => {
        await requireOperationalAccess(phrase._id, phrase.role);
        if (!mongoose.Types.ObjectId.isValid(params.id)) {
            set.status = 400;
            return { error: true, message: 'معرف الطلب غير صالح' };
        }
        const request = await homeCareRequestService.getForDashboard(params.id);
        if (!request) {
            set.status = 404;
            return { error: true, message: 'الطلب غير موجود' };
        }
        return {
            error: false,
            message: 'تم جلب طلب الرعاية المنزلية بنجاح',
            data: formatHomeCareRequestForDashboard(request),
        };
    }, {
        params: t.Object({ id: t.String() }),
        response: {
            200: DashboardHomeCareRequestResponseSchema,
            400: BadRequestResponseSchema,
            403: ForbiddenResponseSchema,
            404: NotFoundResponseSchema,
            ...ProtectedApiErrorResponses,
        },
    })
    .get('/:id/history', async ({ params, phrase, set }) => {
        await requireOperationalAccess(phrase._id, phrase.role);
        if (!mongoose.Types.ObjectId.isValid(params.id)) { set.status = 400; return { error: true, message: 'معرف الطلب غير صالح' }; }
        const request = await homeCareRequestService.getForDashboard(params.id);
        if (!request) throw new DomainError('الطلب غير موجود', 404);
        const history = await homeCareRequestHistoryService.list(params.id);
        return { error: false, message: 'تم جلب سجل الطلب بنجاح', data: history.map(formatHistory) };
    }, { params: t.Object({ id: t.String() }), response: { 200: HomeCareHistoryListResponseSchema, 403: ForbiddenResponseSchema, 404: NotFoundResponseSchema, ...ProtectedApiErrorResponses } })
    .patch('/:id/assign', async ({ params, body, phrase }) => {
        await requireOperationalAccess(phrase._id, phrase.role);
        const request = await homeCareDispatchService.assign(params.id, body.nurse_id, dispatchActor(phrase._id, `/dash/admin/home-care/requests/${params.id}/assign`));
        return { error: false, message: 'تم تعيين الممرض بنجاح', data: formatHomeCareRequestForDashboard(request) };
    }, { params: t.Object({ id: t.String() }), body: t.Object({ nurse_id: t.String() }, { additionalProperties: false }), response: { 200: DashboardHomeCareRequestResponseSchema, 400: BadRequestResponseSchema, 403: ForbiddenResponseSchema, 404: NotFoundResponseSchema, 409: ConflictResponseSchema, 422: t.Union([ValidationErrorResponseSchema, UnprocessableEntityResponseSchema]), ...ProtectedApiErrorResponses } })
    .patch('/:id/reassign', async ({ params, body, phrase }) => {
        await requireOperationalAccess(phrase._id, phrase.role);
        const request = await homeCareDispatchService.reassign(params.id, body.nurse_id, body.reason, dispatchActor(phrase._id, `/dash/admin/home-care/requests/${params.id}/reassign`));
        return { error: false, message: 'تم إعادة تعيين الممرض بنجاح', data: formatHomeCareRequestForDashboard(request) };
    }, { params: t.Object({ id: t.String() }), body: t.Object({ nurse_id: t.String(), reason: t.Optional(t.Nullable(t.String({ maxLength: 1000 }))) }, { additionalProperties: false }), response: { 200: DashboardHomeCareRequestResponseSchema, 400: BadRequestResponseSchema, 403: ForbiddenResponseSchema, 404: NotFoundResponseSchema, 409: ConflictResponseSchema, 422: t.Union([ValidationErrorResponseSchema, UnprocessableEntityResponseSchema]), ...ProtectedApiErrorResponses } })
    .patch('/:id/unassign', async ({ params, body, phrase }) => {
        await requireOperationalAccess(phrase._id, phrase.role);
        const request = await homeCareDispatchService.unassign(params.id, body.reason, dispatchActor(phrase._id, `/dash/admin/home-care/requests/${params.id}/unassign`));
        return { error: false, message: 'تم إلغاء تعيين الممرض بنجاح', data: formatHomeCareRequestForDashboard(request) };
    }, { params: t.Object({ id: t.String() }), body: t.Object({ reason: t.String({ minLength: 1, maxLength: 1000 }) }, { additionalProperties: false }), response: { 200: DashboardHomeCareRequestResponseSchema, 400: BadRequestResponseSchema, 403: ForbiddenResponseSchema, 404: NotFoundResponseSchema, 409: ConflictResponseSchema, 422: ValidationErrorResponseSchema, ...ProtectedApiErrorResponses } })
    .patch('/:id/reopen', async ({ params, body, phrase }) => {
        await requireOperationalAccess(phrase._id, phrase.role);
        const request = await homeCareDispatchService.reopen(params.id, body.reason, dispatchActor(phrase._id, `/dash/admin/home-care/requests/${params.id}/reopen`));
        return { error: false, message: 'تم إعادة فتح الطلب بنجاح', data: formatHomeCareRequestForDashboard(request) };
    }, { params: t.Object({ id: t.String() }), body: t.Object({ reason: t.String({ minLength: 1, maxLength: 1000 }) }, { additionalProperties: false }), response: { 200: DashboardHomeCareRequestResponseSchema, 400: BadRequestResponseSchema, 403: ForbiddenResponseSchema, 404: NotFoundResponseSchema, 409: ConflictResponseSchema, 422: ValidationErrorResponseSchema, ...ProtectedApiErrorResponses } })
    .patch('/:id/reject', async ({ params, body, phrase }) => {
        await requireOperationalAccess(phrase._id, phrase.role);
        const request = await homeCareRequestService.rejectForAdmin(params.id, body.reason, adminActor(phrase._id, `/dash/admin/home-care/requests/${params.id}/reject`));
        return { error: false, message: 'تم رفض طلب الرعاية المنزلية', data: formatHomeCareRequestForDashboard(request) };
    }, { params: t.Object({ id: t.String() }), body: t.Object({ reason: t.String({ minLength: 1, maxLength: 1000 }) }, { additionalProperties: false }), response: { 200: DashboardHomeCareRequestResponseSchema, 400: BadRequestResponseSchema, 403: ForbiddenResponseSchema, 404: NotFoundResponseSchema, 409: ConflictResponseSchema, 422: ValidationErrorResponseSchema, ...ProtectedApiErrorResponses } })
    .patch('/:id/status', async ({ params, body, phrase, set }) => {
        await requireOperationalAccess(phrase._id, phrase.role);
        if (!mongoose.Types.ObjectId.isValid(params.id)) {
            set.status = 400;
            return { error: true, message: 'معرف الطلب غير صالح' };
        }
        const request = await homeCareRequestService.updateStatus(
            params.id,
            body.status,
            adminActor(phrase._id, `/dash/admin/home-care/requests/${params.id}/status`)
        );
        return {
            error: false,
            message: 'تم تحديث حالة طلب الرعاية المنزلية بنجاح',
            data: formatHomeCareRequestForDashboard(request),
        };
    }, {
        params: t.Object({ id: t.String() }),
        body: t.Object({ status: t.Enum(IHomeCareRequestStatusEnum) }, { additionalProperties: false }),
        response: {
            200: DashboardHomeCareRequestResponseSchema,
            400: BadRequestResponseSchema,
            403: ForbiddenResponseSchema,
            404: NotFoundResponseSchema,
            409: ConflictResponseSchema,
            422: ValidationErrorResponseSchema,
            ...ProtectedApiErrorResponses,
        },
    })
    .patch('/:id/cancel', async ({ params, body, phrase, set }) => {
        await requireOperationalAccess(phrase._id, phrase.role);
        if (!mongoose.Types.ObjectId.isValid(params.id)) {
            set.status = 400;
            return { error: true, message: 'معرف الطلب غير صالح' };
        }
        const request = await homeCareRequestService.cancelForAdmin(
            params.id,
            body.reason,
            adminActor(phrase._id, `/dash/admin/home-care/requests/${params.id}/cancel`)
        );
        return {
            error: false,
            message: 'تم إلغاء طلب الرعاية المنزلية بنجاح',
            data: formatHomeCareRequestForDashboard(request),
        };
    }, {
        params: t.Object({ id: t.String() }),
        body: t.Object({
            reason: t.Optional(t.Nullable(t.String({ maxLength: 1000 }))),
        }, { additionalProperties: false }),
        response: {
            200: DashboardHomeCareRequestResponseSchema,
            400: BadRequestResponseSchema,
            403: ForbiddenResponseSchema,
            404: NotFoundResponseSchema,
            409: ConflictResponseSchema,
            422: ValidationErrorResponseSchema,
            ...ProtectedApiErrorResponses,
        },
    })
    .patch('/:id/internal-note', async ({ params, body, phrase, set }) => {
        await requireOperationalAccess(phrase._id, phrase.role);
        if (!mongoose.Types.ObjectId.isValid(params.id)) {
            set.status = 400;
            return { error: true, message: 'معرف الطلب غير صالح' };
        }
        const request = await homeCareRequestService.updateInternalNote(
            params.id,
            body.internal_notes,
            adminActor(phrase._id, `/dash/admin/home-care/requests/${params.id}/internal-note`)
        );
        return {
            error: false,
            message: 'تم تحديث الملاحظة الداخلية بنجاح',
            data: formatHomeCareRequestForDashboard(request),
        };
    }, {
        params: t.Object({ id: t.String() }),
        body: t.Object({
            internal_notes: t.Nullable(t.String({ maxLength: 3000 })),
        }, { additionalProperties: false }),
        response: {
            200: DashboardHomeCareRequestResponseSchema,
            400: BadRequestResponseSchema,
            403: ForbiddenResponseSchema,
            404: NotFoundResponseSchema,
            422: ValidationErrorResponseSchema,
            ...ProtectedApiErrorResponses,
        },
    });
