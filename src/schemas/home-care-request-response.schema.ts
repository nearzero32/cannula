import { t } from 'elysia';
import {
    IHomeCareRequestCancelledByTypeEnum,
    IHomeCareRequestStatusEnum,
} from '../interfaces/home-care-request.interface';
import { paginatedResponse, successResponse } from './api-response.schema';

const nullableString = t.Nullable(t.String());

export const HomeCareRequestAddressSchema = t.Object({
    address_text: t.String(),
    lat: t.Number({ minimum: -90, maximum: 90 }),
    lng: t.Number({ minimum: -180, maximum: 180 }),
});

export const HomeCareRequestBeneficiarySchema = t.Union([
    t.Object({ type: t.Literal('SELF') }),
    t.Object({
        type: t.Literal('CHILD'),
        child: t.Object({
            _id: t.String(),
            full_name: t.String(),
            age: t.Integer({ minimum: 0 }),
        }),
    }),
]);

export const HomeCareRequestCancellationSchema = t.Nullable(t.Object({
    cancelled_at: t.String({ format: 'date-time' }),
    cancelled_by: t.Object({
        id: t.String(),
        type: t.Enum(IHomeCareRequestCancelledByTypeEnum),
    }),
    reason: nullableString,
}));

export const MobileHomeCareRequestSchema = t.Object({
    _id: t.String(),
    request_number: t.String(),
    service: t.Object({
        _id: t.String(),
        category_id: t.String(),
        name: t.String(),
        price: t.Integer(),
        duration_min: t.Nullable(t.Integer()),
        duration_max: t.Nullable(t.Integer()),
    }),
    beneficiary: HomeCareRequestBeneficiarySchema,
    requested_date: t.String({ format: 'date-time' }),
    preferred_time: t.String({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }),
    address: HomeCareRequestAddressSchema,
    notes: nullableString,
    status: t.Enum(IHomeCareRequestStatusEnum),
    cancellation: HomeCareRequestCancellationSchema,
    createdAt: t.String({ format: 'date-time' }),
    updatedAt: t.String({ format: 'date-time' }),
});

export const DashboardHomeCareRequestSchema = t.Composite([
    MobileHomeCareRequestSchema,
    t.Object({
        patient: t.Object({
            _id: t.String(),
            full_name: nullableString,
            phone: nullableString,
            profile_photo: nullableString,
        }),
        internal_notes: nullableString,
    }),
]);

export const MobileHomeCareRequestResponseSchema = successResponse(
    MobileHomeCareRequestSchema,
    'تم جلب طلب الرعاية المنزلية بنجاح'
);
export const MobileHomeCareRequestListResponseSchema = paginatedResponse(
    MobileHomeCareRequestSchema,
    'تم جلب طلبات الرعاية المنزلية بنجاح'
);
export const DashboardHomeCareRequestResponseSchema = successResponse(
    DashboardHomeCareRequestSchema,
    'تم جلب طلب الرعاية المنزلية بنجاح'
);
export const DashboardHomeCareRequestListResponseSchema = paginatedResponse(
    DashboardHomeCareRequestSchema,
    'تم جلب طلبات الرعاية المنزلية بنجاح'
);
