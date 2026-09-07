import Elysia, { t } from 'elysia';
import mongoose from 'mongoose';
import { SWAGGER_TAGS } from '../../constants/swagger-tags';
import homeCareCategoryService, { MOBILE_HOME_CARE_CATEGORIES_CACHE_KEY, MOBILE_HOME_CARE_CACHE_TTL_SECONDS } from '../../services/home-care-category.service';
import homeCareServiceService, { mobileHomeCareServicesCacheKey } from '../../services/home-care-service.service';
import homeCareAvailabilityService from '../../services/home-care-availability.service';
import { DomainError } from '../../services/domain-error';
import RedisClient from '../../databases/redis';
import type { HomeCareCategoryDocument } from '../../models/home-care-category.model';
import type { HomeCareServiceDocument } from '../../models/home-care-service.model';
import {
    BadRequestResponseSchema,
    InternalServerErrorResponseSchema,
    NotFoundResponseSchema,
    RateLimitResponseSchema,
    UnprocessableEntityResponseSchema,
} from '../../schemas/api-response.schema';
import {
    MobileHomeCareCategoryListResponseSchema,
    MobileHomeCareServiceListResponseSchema,
    MobileHomeCareServiceResponseSchema,
    MobileHomeCareAvailabilityResponseSchema,
} from '../../schemas/home-care-response.schema';

const ObjectId = mongoose.Types.ObjectId;

export function formatHomeCareCategory(category: HomeCareCategoryDocument) {
    return {
        _id: String(category._id),
        name: category.name,
        description: category.description ?? null,
        icon: category.icon ?? null,
        image: category.image ?? null,
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
    };
}

export const mobileHomeCareController = new Elysia({
    prefix: '/home-care',
    detail: { tags: [SWAGGER_TAGS.MOBILE.HOME_CARE] },
})
    .onError(({ code, error, set }) => {
        if (error instanceof DomainError) { set.status = error.status; return { error: true, message: error.message, code: error.code }; }
        if (code === 'UNKNOWN' || code === 'INTERNAL_SERVER_ERROR') {
            set.status = 500;
            return { error: true, message: 'حدث خطأ في الخادم' };
        }
    })
    .get('/services/:id/availability', async ({ params, query }) => {
        const slots = await homeCareAvailabilityService.listForMobile(params.id, query.date);
        return { error: false, message: 'تم جلب أوقات التوفر بنجاح', data: { service_id: params.id, date: query.date, timezone: 'Asia/Baghdad' as const, slots: slots.map(slot => ({ _id: String(slot._id), time: slot.time })) } };
    }, {
        params: t.Object({ id: t.String() }), query: t.Object({ date: t.String({ format: 'date' }) }, { additionalProperties: false }),
        detail: { description: 'قائمة غير مخزنة في Redis لأنها تعتمد على الوقت الحالي وقاعدة مهلة 30 دقيقة.' },
        response: { 200: MobileHomeCareAvailabilityResponseSchema, 400: BadRequestResponseSchema, 404: NotFoundResponseSchema, 422: UnprocessableEntityResponseSchema, 429: RateLimitResponseSchema, 500: InternalServerErrorResponseSchema },
    })
    .get('/categories', async () => {
        try { const raw = await RedisClient.getInstance().get(MOBILE_HOME_CARE_CATEGORIES_CACHE_KEY); if (raw) { try { return JSON.parse(raw); } catch { try { await RedisClient.getInstance().del(MOBILE_HOME_CARE_CATEGORIES_CACHE_KEY); } catch {} } } } catch { console.warn('Unable to read mobile home-care categories cache'); }
        const categories = await homeCareCategoryService.listActive();
        const response = {
            error: false,
            message: 'تم جلب أنواع الرعاية المنزلية بنجاح',
            data: categories.map(formatHomeCareCategory),
        }; try { await RedisClient.getInstance().set(MOBILE_HOME_CARE_CATEGORIES_CACHE_KEY, JSON.stringify(response), MOBILE_HOME_CARE_CACHE_TTL_SECONDS); } catch { console.warn('Unable to write mobile home-care categories cache'); } return response;
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
        const cacheKey = mobileHomeCareServicesCacheKey(query.categoryId);
        try { const raw = await RedisClient.getInstance().get(cacheKey); if (raw) { try { return JSON.parse(raw); } catch { try { await RedisClient.getInstance().del(cacheKey); } catch {} } } } catch { console.warn('Unable to read mobile home-care services cache'); }
        const services = await homeCareServiceService.listActive(query.categoryId);
        const response = {
            error: false,
            message: 'تم جلب خدمات الرعاية المنزلية بنجاح',
            data: services.map(formatHomeCareService),
        }; try { await RedisClient.getInstance().set(cacheKey, JSON.stringify(response), MOBILE_HOME_CARE_CACHE_TTL_SECONDS); } catch { console.warn('Unable to write mobile home-care services cache'); } return response;
    }, {
        query: t.Object({ categoryId: t.Optional(t.String()) }, { additionalProperties: false }),
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
