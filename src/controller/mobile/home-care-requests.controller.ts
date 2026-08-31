import Elysia, { t } from 'elysia';
import mongoose from 'mongoose';
import { AuthPlugin } from '../../middleware/auth.middleware';
import patientService from '../../services/patient.service';
import homeCareRequestService from '../../services/home-care-request.service';
import { formatHomeCareRequestForMobile } from '../../services/home-care-request.formatter';
import { DomainError } from '../../services/domain-error';
import { IUserRoleEnum } from '../../interfaces/user.interface';
import { IHomeCareRequestStatusEnum } from '../../interfaces/home-care-request.interface';
import {
    BadRequestResponseSchema,
    ConflictResponseSchema,
    ForbiddenResponseSchema,
    NotFoundResponseSchema,
    ProtectedApiErrorResponses,
    UnprocessableEntityResponseSchema,
    ValidationErrorResponseSchema,
} from '../../schemas/api-response.schema';
import {
    MobileHomeCareRequestListResponseSchema,
    MobileHomeCareRequestResponseSchema,
} from '../../schemas/home-care-request-response.schema';

const requestBodySchema = t.Object({
    service_id: t.String(),
    child_id: t.Optional(t.Nullable(t.String())),
    requested_date: t.String({ format: 'date' }),
    preferred_time: t.String({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }),
    address: t.Object({
        address_text: t.String({ minLength: 5, maxLength: 500 }),
        lat: t.Number({ minimum: -90, maximum: 90 }),
        lng: t.Number({ minimum: -180, maximum: 180 }),
    }, { additionalProperties: false }),
    notes: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
}, { additionalProperties: false });

const cancellationBodySchema = t.Object({
    reason: t.Optional(t.Nullable(t.String({ maxLength: 1000 }))),
}, { additionalProperties: false });

function pagination(page: number, limit: number, total: number) {
    const pages = Math.ceil(total / limit);
    return { page, limit, total, pages, hasNext: page < pages, hasPrev: page > 1 };
}

async function requirePatient(phrase: { _id: string; role: string }) {
    if (phrase.role !== IUserRoleEnum.PATIENT) throw new DomainError('غير مصرح لك بالوصول', 403);
    const patient = await patientService.getByUserId(phrase._id);
    if (!patient) throw new DomainError('الملف الشخصي غير موجود', 404);
    return patient;
}

function mobileActor(userId: string, endpoint: string) {
    return {
        user_id: userId,
        user_name: `patient_${userId}`,
        user_type: 'patient' as const,
        endpoint,
        source: 'mobile' as const,
    };
}

export const mobileHomeCareRequestsController = new Elysia({
    prefix: '/home-care/requests',
    detail: { tags: ['Mobile'] },
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
    .post('/', async ({ body, phrase, set }) => {
        const patient = await requirePatient(phrase);
        const request = await homeCareRequestService.createForPatient(
            new mongoose.Types.ObjectId(patient._id.toString()),
            {
                service_id: body.service_id,
                child_id: body.child_id,
                requested_date: body.requested_date,
                preferred_time: body.preferred_time,
                address: {
                    address_text: body.address.address_text,
                    lat: body.address.lat,
                    lng: body.address.lng,
                },
                notes: body.notes,
            },
            mobileActor(phrase._id, '/mobile/home-care/requests')
        );
        set.status = 201;
        return {
            error: false,
            message: 'تم إرسال طلب الرعاية المنزلية بنجاح',
            data: formatHomeCareRequestForMobile(request),
        };
    }, {
        body: requestBodySchema,
        response: {
            201: MobileHomeCareRequestResponseSchema,
            400: BadRequestResponseSchema,
            403: ForbiddenResponseSchema,
            404: NotFoundResponseSchema,
            409: ConflictResponseSchema,
            422: t.Union([ValidationErrorResponseSchema, UnprocessableEntityResponseSchema]),
            ...ProtectedApiErrorResponses,
        },
    })
    .get('/', async ({ query, phrase }) => {
        const patient = await requirePatient(phrase);
        const page = Math.max(1, Number(query.page) || 1);
        const limit = Math.min(100, Math.max(1, Number(query.limit) || 10));
        const { data, count } = await homeCareRequestService.listForPatient(
            new mongoose.Types.ObjectId(patient._id.toString()),
            { page, limit, status: query.status }
        );
        return {
            error: false,
            message: 'تم جلب طلبات الرعاية المنزلية بنجاح',
            data: data.map(formatHomeCareRequestForMobile),
            pagination: pagination(page, limit, count),
        };
    }, {
        query: t.Object({
            page: t.Optional(t.String()),
            limit: t.Optional(t.String()),
            status: t.Optional(t.Enum(IHomeCareRequestStatusEnum)),
        }),
        response: {
            200: MobileHomeCareRequestListResponseSchema,
            403: ForbiddenResponseSchema,
            404: NotFoundResponseSchema,
            422: ValidationErrorResponseSchema,
            ...ProtectedApiErrorResponses,
        },
    })
    .get('/:id', async ({ params, phrase, set }) => {
        const patient = await requirePatient(phrase);
        if (!mongoose.Types.ObjectId.isValid(params.id)) {
            set.status = 400;
            return { error: true, message: 'معرف الطلب غير صالح' };
        }
        const request = await homeCareRequestService.getForPatient(
            new mongoose.Types.ObjectId(patient._id.toString()),
            params.id
        );
        if (!request) {
            set.status = 404;
            return { error: true, message: 'الطلب غير موجود' };
        }
        return {
            error: false,
            message: 'تم جلب طلب الرعاية المنزلية بنجاح',
            data: formatHomeCareRequestForMobile(request),
        };
    }, {
        params: t.Object({ id: t.String() }),
        response: {
            200: MobileHomeCareRequestResponseSchema,
            400: BadRequestResponseSchema,
            403: ForbiddenResponseSchema,
            404: NotFoundResponseSchema,
            ...ProtectedApiErrorResponses,
        },
    })
    .patch('/:id/cancel', async ({ params, body, phrase, set }) => {
        const patient = await requirePatient(phrase);
        if (!mongoose.Types.ObjectId.isValid(params.id)) {
            set.status = 400;
            return { error: true, message: 'معرف الطلب غير صالح' };
        }
        const request = await homeCareRequestService.cancelForPatient(
            new mongoose.Types.ObjectId(patient._id.toString()),
            params.id,
            body.reason,
            mobileActor(phrase._id, `/mobile/home-care/requests/${params.id}/cancel`)
        );
        return {
            error: false,
            message: 'تم إلغاء طلب الرعاية المنزلية بنجاح',
            data: formatHomeCareRequestForMobile(request),
        };
    }, {
        params: t.Object({ id: t.String() }),
        body: cancellationBodySchema,
        response: {
            200: MobileHomeCareRequestResponseSchema,
            400: BadRequestResponseSchema,
            403: ForbiddenResponseSchema,
            404: NotFoundResponseSchema,
            409: ConflictResponseSchema,
            422: ValidationErrorResponseSchema,
            ...ProtectedApiErrorResponses,
        },
    });
