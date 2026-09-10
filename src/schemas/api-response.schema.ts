import { t } from 'elysia';
import type { TSchema } from '@sinclair/typebox';

export const PaginationSchema = t.Object({
    page: t.Integer(),
    limit: t.Integer(),
    total: t.Integer(),
    pages: t.Integer(),
    hasNext: t.Boolean(),
    hasPrev: t.Boolean(),
}, { description: 'بيانات ترقيم الصفحات' });

export function errorResponse(description: string, message: string) {
    return t.Object({
        error: t.Literal(true),
        message: t.String(),
        code: t.Optional(t.String({ description: 'رمز خطأ ثابت قابل للاستهلاك برمجياً عند توفره' })),
    }, {
        description,
        examples: [{ error: true, message }],
        additionalProperties: true,
    });
}

export function successResponse<TData extends TSchema>(dataSchema: TData, description = 'تمت العملية بنجاح') {
    return t.Object({
        error: t.Literal(false),
        message: t.String(),
        data: dataSchema,
    }, { description });
}

export const SuccessResponseWithoutDataSchema = t.Object({
    error: t.Literal(false),
    message: t.String(),
}, { description: 'تمت العملية بنجاح' });

export const SuccessDataWithoutMessageSchema = t.Object({
    error: t.Literal(false),
    data: t.Unknown(),
}, { description: 'تمت العملية بنجاح' });

export function paginatedResponse<TItem extends TSchema>(itemSchema: TItem, description = 'تم جلب البيانات بنجاح') {
    return t.Object({
        error: t.Literal(false),
        message: t.String(),
        data: t.Array(itemSchema),
        pagination: PaginationSchema,
    }, { description });
}

/** Strict API envelope with intentionally flexible legacy data until a stable DTO is available. */
export const GenericDataResponseSchema = successResponse(t.Unknown());
export const GenericArrayResponseSchema = successResponse(t.Array(t.Unknown()));
export const GenericPaginatedResponseSchema = paginatedResponse(t.Unknown());

export const BadRequestResponseSchema = errorResponse('طلب غير صالح', 'البيانات المدخلة غير صحيحة');
export const UnauthorizedResponseSchema = errorResponse('المصادقة مطلوبة', 'غير مصرح لك بالدخول');
export const ForbiddenResponseSchema = errorResponse('لا توجد صلاحية لتنفيذ الإجراء', 'ليس لديك صلاحية لتنفيذ هذا الإجراء');
export const NotFoundResponseSchema = errorResponse('السجل المطلوب غير موجود', 'السجل غير موجود');
export const ConflictResponseSchema = errorResponse('تعارض مع سجل موجود', 'هذا السجل موجود مسبقاً');
export const AppointmentSlotConflictResponseSchema = errorResponse(
    'تعارض مع موعد محجوز',
    'هذا الموعد محجوز بالفعل'
);
export const UnprocessableEntityResponseSchema = errorResponse('تعذر تنفيذ الطلب وفق حالة السجل الحالية', 'لا يمكن تنفيذ هذا الإجراء في الحالة الحالية');
export const InternalServerErrorResponseSchema = errorResponse('خطأ داخلي آمن', 'حدث خطأ في الخادم');
export const ServiceUnavailableResponseSchema = errorResponse('الخدمة غير متاحة حالياً', 'الخدمة غير متاحة حالياً');

export const ValidationErrorResponseSchema = t.Object({
    error: t.Literal(true),
    message: t.Literal('بيانات الطلب غير صالحة'),
    error_message: t.String({
        minLength: 1,
        description: 'سبب فشل التحقق بصيغة قابلة للعرض أو التسجيل من دون كشف كامل الطلب',
    }),
    requestId: t.String(),
}, {
    description: 'خطأ تحقق موحد للموبايل والداشبورد',
    additionalProperties: false,
    examples: [{
        error: true,
        message: 'بيانات الطلب غير صالحة',
        error_message: "Property 'phone' is missing",
        requestId: 'e239ec47-a861-4b37-8783-bfc315f02d00',
    }],
});

export const ValidationOrBusinessRuleResponseSchema = t.Union([
    ValidationErrorResponseSchema,
    UnprocessableEntityResponseSchema,
], { description: 'خطأ تحقق أو تعارض مع حالة السجل الحالية' });

export const RATE_LIMIT_MESSAGE = 'لقد تجاوزت الحد المسموح به من الطلبات، يرجى المحاولة لاحقاً';
export const RATE_LIMIT_RESPONSE = { error: true, message: RATE_LIMIT_MESSAGE } as const;
export const RateLimitResponseSchema = t.Object({
    error:t.Literal(true), message:t.String(), code:t.Optional(t.String()),
    retryAfterSeconds:t.Optional(t.Integer({minimum:1})),
},{description:'تم تجاوز حد الطلبات؛ Retry-After يحمل القيمة نفسها عند توفرها',additionalProperties:true});

export const PublicApiErrorResponses = {
    429: RateLimitResponseSchema,
    500: InternalServerErrorResponseSchema,
};

export const ProtectedApiErrorResponses = {
    401: UnauthorizedResponseSchema,
    429: RateLimitResponseSchema,
    500: InternalServerErrorResponseSchema,
};
