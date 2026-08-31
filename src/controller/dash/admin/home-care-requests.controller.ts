import Elysia, { t } from 'elysia';
import mongoose from 'mongoose';
import { SWAGGER_TAGS } from '../../../constants/swagger-tags';
import { AuthPlugin } from '../../../middleware/auth.middleware';
import homeCarePolicyService from '../../../services/home-care-policy.service';
import homeCareRequestService from '../../../services/home-care-request.service';
import { formatHomeCareRequestForDashboard } from '../../../services/home-care-request.formatter';
import { DomainError } from '../../../services/domain-error';
import { IHomeCareRequestStatusEnum } from '../../../interfaces/home-care-request.interface';
import {
    BadRequestResponseSchema,
    ConflictResponseSchema,
    ForbiddenResponseSchema,
    NotFoundResponseSchema,
    ProtectedApiErrorResponses,
    ValidationErrorResponseSchema,
} from '../../../schemas/api-response.schema';
import {
    DashboardHomeCareRequestListResponseSchema,
    DashboardHomeCareRequestResponseSchema,
} from '../../../schemas/home-care-request-response.schema';

function pagination(page: number, limit: number, total: number) {
    const pages = Math.ceil(total / limit);
    return { page, limit, total, pages, hasNext: page < pages, hasPrev: page > 1 };
}

async function requireOperationalAccess(userId: string, role: 'admin' | 'doctor' | 'patient') {
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

export const homeCareRequestsAdminController = new Elysia({
    prefix: '/requests',
    detail: { tags: [SWAGGER_TAGS.ADMIN.HOME_CARE] },
})
    .use(AuthPlugin())
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
