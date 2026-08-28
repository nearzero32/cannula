import Elysia, { t } from 'elysia';
import mongoose from 'mongoose';
import homeCareCategoryService from '../../services/home-care-category.service';
import homeCareServiceService from '../../services/home-care-service.service';
import type { HomeCareCategoryDocument } from '../../models/home-care-category.model';
import type { HomeCareServiceDocument } from '../../models/home-care-service.model';
import {
    BadRequestResponseSchema,
    InternalServerErrorResponseSchema,
    NotFoundResponseSchema,
    RateLimitResponseSchema,
} from '../../schemas/api-response.schema';
import {
    MobileHomeCareCategoryListResponseSchema,
    MobileHomeCareServiceListResponseSchema,
    MobileHomeCareServiceResponseSchema,
} from '../../schemas/home-care-response.schema';

const ObjectId = mongoose.Types.ObjectId;

export function formatHomeCareCategory(category: HomeCareCategoryDocument) {
    return {
        _id: String(category._id),
        name: category.name,
        description: category.description ?? null,
        icon: category.icon ?? null,
        image: category.image ?? null,
        display_order: category.display_order,
    };
}

export function formatHomeCareService(service: HomeCareServiceDocument) {
    return {
        _id: String(service._id),
        category_id: String(service.category_id),
        name: service.name,
        short_description: service.short_description ?? null,
        description: service.description ?? null,
        image: service.image ?? null,
        duration_min: service.duration_min ?? null,
        duration_max: service.duration_max ?? null,
        price: service.price,
        display_order: service.display_order,
    };
}

export const mobileHomeCareController = new Elysia({ prefix: '/home-care', detail: { tags: ['Mobile'] } })
    .onError(({ code, set }) => {
        if (code === 'UNKNOWN' || code === 'INTERNAL_SERVER_ERROR') {
            set.status = 500;
            return { error: true, message: 'حدث خطأ في الخادم' };
        }
    })
    .get('/categories', async () => {
        const categories = await homeCareCategoryService.listActive();
        return {
            error: false,
            message: 'تم جلب أنواع الرعاية المنزلية بنجاح',
            data: categories.map(formatHomeCareCategory),
        };
    }, {
        response: {
            200: MobileHomeCareCategoryListResponseSchema,
            429: RateLimitResponseSchema,
            500: InternalServerErrorResponseSchema,
        },
    })
    .get('/services', async ({ query, set }) => {
        if (query.categoryId && !ObjectId.isValid(query.categoryId)) {
            set.status = 400;
            return { error: true, message: 'معرف نوع الرعاية المنزلية غير صالح' };
        }
        const services = await homeCareServiceService.listActive(query.categoryId);
        return {
            error: false,
            message: 'تم جلب خدمات الرعاية المنزلية بنجاح',
            data: services.map(formatHomeCareService),
        };
    }, {
        query: t.Object({ categoryId: t.Optional(t.String()) }),
        response: {
            200: MobileHomeCareServiceListResponseSchema,
            400: BadRequestResponseSchema,
            429: RateLimitResponseSchema,
            500: InternalServerErrorResponseSchema,
        },
    })
    .get('/services/:id', async ({ params, set }) => {
        if (!ObjectId.isValid(params.id)) {
            set.status = 400;
            return { error: true, message: 'معرف الخدمة غير صالح' };
        }
        const service = await homeCareServiceService.getActiveById(params.id);
        if (!service) {
            set.status = 404;
            return { error: true, message: 'الخدمة غير موجودة' };
        }
        return { error: false, message: 'تم جلب الخدمة بنجاح', data: formatHomeCareService(service) };
    }, {
        params: t.Object({ id: t.String() }),
        response: {
            200: MobileHomeCareServiceResponseSchema,
            400: BadRequestResponseSchema,
            404: NotFoundResponseSchema,
            429: RateLimitResponseSchema,
            500: InternalServerErrorResponseSchema,
        },
    });
