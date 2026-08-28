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
    }, {
        description,
        examples: [{ error: true, message }],
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

export function paginatedResponse<TItem extends TSchema>(itemSchema: TItem, description = 'تم جلب البيانات بنجاح') {
    return t.Object({
        error: t.Literal(false),
        message: t.String(),
        data: t.Array(itemSchema),
        pagination: PaginationSchema,
    }, { description });
}

export const BadRequestResponseSchema = errorResponse('طلب غير صالح', 'البيانات المدخلة غير صحيحة');
export const UnauthorizedResponseSchema = errorResponse('المصادقة مطلوبة', 'غير مصرح لك بالدخول');
export const ForbiddenResponseSchema = errorResponse('لا توجد صلاحية لتنفيذ الإجراء', 'ليس لديك صلاحية لتنفيذ هذا الإجراء');
export const NotFoundResponseSchema = errorResponse('السجل المطلوب غير موجود', 'السجل غير موجود');
export const ConflictResponseSchema = errorResponse('تعارض مع سجل موجود', 'هذا السجل موجود مسبقاً');
export const InternalServerErrorResponseSchema = errorResponse('خطأ داخلي آمن', 'حدث خطأ في الخادم');

export const ValidationErrorResponseSchema = t.Object({
    type: t.Literal('validation'),
    on: t.String(),
    property: t.Optional(t.String()),
    message: t.String(),
    summary: t.Optional(t.String()),
    expected: t.Optional(t.Unknown()),
    found: t.Optional(t.Unknown()),
    errors: t.Optional(t.Array(t.Unknown())),
}, {
    description: 'خطأ تحقق Elysia الأصلي',
    examples: [{
        type: 'validation',
        on: 'body',
        property: '/price',
        message: 'Expected union value',
        summary: "Property 'price' should be one of: 'integer', 'integer'",
        expected: { price: 0 },
        found: { price: 0 },
        errors: [],
    }],
});

export const RATE_LIMIT_MESSAGE = 'لقد تجاوزت الحد المسموح به من الطلبات، يرجى المحاولة لاحقاً';
export const RATE_LIMIT_RESPONSE = { error: true, message: RATE_LIMIT_MESSAGE } as const;
export const RateLimitResponseSchema = errorResponse('تم تجاوز حد الطلبات', RATE_LIMIT_MESSAGE);
