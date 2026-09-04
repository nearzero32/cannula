import { t } from 'elysia';
import { IHomeCareStatusEnum } from '../interfaces/home-care.interface';
import { paginatedResponse, successResponse } from './api-response.schema';

const nullableString = t.Nullable(t.String());

export const HomeCareCategorySchema = t.Object({
    _id: t.String(),
    name: t.String(),
    description: nullableString,
    icon: nullableString,
    image: nullableString,
    status: t.Enum(IHomeCareStatusEnum),
    display_order: t.Integer(),
    created_by: nullableString,
    createdAt: t.String({ format: 'date-time' }),
    updatedAt: t.String({ format: 'date-time' }),
});

export const MobileHomeCareCategorySchema = t.Object({
    _id: t.String(),
    name: t.String(),
    description: nullableString,
    icon: nullableString,
    image: nullableString,
});

export const HomeCareServiceSchema = t.Object({
    _id: t.String(),
    category_id: t.String(),
    name: t.String(),
    short_description: nullableString,
    description: nullableString,
    image: nullableString,
    duration_min: t.Nullable(t.Integer()),
    duration_max: t.Nullable(t.Integer()),
    price: t.Integer(),
    status: t.Enum(IHomeCareStatusEnum),
    display_order: t.Integer(),
    created_by: nullableString,
    createdAt: t.String({ format: 'date-time' }),
    updatedAt: t.String({ format: 'date-time' }),
});

export const MobileHomeCareServiceSchema = t.Object({
    _id: t.String(),
    category_id: t.String(),
    name: t.String(),
    short_description: nullableString,
    description: nullableString,
    image: nullableString,
    duration_min: t.Nullable(t.Integer()),
    duration_max: t.Nullable(t.Integer()),
    price: t.Integer(),
});

export const HomeCareCategoryResponseSchema = successResponse(HomeCareCategorySchema, 'تم جلب نوع الرعاية المنزلية بنجاح');
export const HomeCareCategoryListResponseSchema = paginatedResponse(HomeCareCategorySchema, 'تم جلب أنواع الرعاية المنزلية بنجاح');
export const HomeCareServiceResponseSchema = successResponse(HomeCareServiceSchema, 'تم جلب خدمة الرعاية المنزلية بنجاح');
export const HomeCareServiceListResponseSchema = paginatedResponse(HomeCareServiceSchema, 'تم جلب خدمات الرعاية المنزلية بنجاح');
export const MobileHomeCareCategoryListResponseSchema = successResponse(t.Array(MobileHomeCareCategorySchema), 'تم جلب أنواع الرعاية المنزلية بنجاح');
export const MobileHomeCareServiceListResponseSchema = successResponse(t.Array(MobileHomeCareServiceSchema), 'تم جلب خدمات الرعاية المنزلية بنجاح');
export const MobileHomeCareServiceResponseSchema = successResponse(MobileHomeCareServiceSchema, 'تم جلب خدمة الرعاية المنزلية بنجاح');
