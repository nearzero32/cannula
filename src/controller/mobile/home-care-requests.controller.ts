import Elysia, { t } from 'elysia';
import mongoose from 'mongoose';
import { SWAGGER_TAGS } from '../../constants/swagger-tags';
import { AuthPlugin } from '../../middleware/auth.middleware';
import { TokenAudienceEnum } from '../../constants/jwt';
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
    availability_slot_id: t.String(),
    preferred_time: t.Optional(t.Never({ description: 'غير مقبول؛ يشتق الخادم الوقت من availability_slot_id' })),
    address: t.Object({
        address_text: t.String({ minLength: 5, maxLength: 500 }),
        lat: t.Number({ minimum: -90, maximum: 90 }),
        lng: t.Number({ minimum: -180, maximum: 180 }),
    }, { additionalProperties: false }),
    notes: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
}, {
    additionalProperties: false,
    examples: [{ service_id: '507f1f77bcf86cd799439011', availability_slot_id: '507f1f77bcf86cd799439012', child_id: null, requested_date: '2099-01-02', address: { address_text: 'بغداد - المنصور', lat: 33.3128, lng: 44.3615 }, notes: 'يرجى الاتصال قبل الوصول' }],
});

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
    detail: { tags: [SWAGGER_TAGS.MOBILE.HOME_CARE] },
})
    .use(AuthPlugin(TokenAudienceEnum.MOBILE))
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
    .post('/', async ({ body, headers, phrase, set }) => {
        const patient = await requirePatient(phrase);
        const result = await homeCareRequestService.createIdempotentForPatient(
            new mongoose.Types.ObjectId(patient._id.toString()),
            {
                service_id: body.service_id,
                child_id: body.child_id,
                requested_date: body.requested_date,
                availability_slot_id: body.availability_slot_id,
                address: {
                    address_text: body.address.address_text,
                    lat: body.address.lat,
                    lng: body.address.lng,
                },
                notes: body.notes,
            },
            mobileActor(phrase._id, '/mobile/home-care/requests'),
            headers['idempotency-key'],
        );
        set.status = result.replayed ? 200 : 201;
        if (result.replayed) set.headers = { 'Idempotent-Replay': 'true' };
        return {
            error: false,
            message: 'تم إرسال طلب الرعاية المنزلية بنجاح',
            data: formatHomeCareRequestForMobile(result.request),
        };
    }, {
        body: requestBodySchema,
        headers: t.Object({
            'idempotency-key': t.String({
                minLength: 36,
                maxLength: 36,
                pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
                description: 'UUID v4 generated once per logical create and reused for network retries',
                examples: ['550e8400-e29b-41d4-a716-446655440000'],
            }),
        }, { additionalProperties: true }),
        detail: { description: 'يتطلب Idempotency-Key من نوع UUID v4 لمدة 24 ساعة، وهو معزول حسب المريض المصادق عليه ويجب إعادة استخدامه عند المحاولة مجدداً. إعادة نفس المفتاح والحمولة تعيد الطلب نفسه؛ الحمولة المختلفة تعطي 409. preferred_time مشتق حصراً من availability_slot_id.' },
        response: {
            200: MobileHomeCareRequestResponseSchema,
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
