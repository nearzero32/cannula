import Elysia, { t } from 'elysia';
import mongoose from 'mongoose';
import { SWAGGER_TAGS } from '../../constants/swagger-tags';
import adsService, { MOBILE_ADS_CACHE_PREFIX, MOBILE_ADS_CACHE_TTL_SECONDS, PATIENT_AD_SORT, publicAdsMatch } from '../../services/ads.service';
import RedisClient from '../../databases/redis';
import { BadRequestResponseSchema, GenericDataResponseSchema, GenericPaginatedResponseSchema, NotFoundResponseSchema, PublicApiErrorResponses } from '../../schemas/api-response.schema';

const ObjectId = mongoose.Types.ObjectId;
function mobileAd(ad: any) { return { _id: String(ad._id), title: ad.title ?? null, description: ad.description ?? null, image: ad.image, start_date: ad.start_date ?? null, end_date: ad.end_date ?? null }; }
function key(page: number, limit: number) { return `${MOBILE_ADS_CACHE_PREFIX}:page=${page}:limit=${limit}`; }

export const mobileAdsController = new Elysia({ prefix: '/ads', detail: { tags: [SWAGGER_TAGS.MOBILE.ADS] } })
    .get('/', async ({ query }) => {
        const page = Math.max(1, Number(query.page) || 1), limit = Math.min(50, Math.max(1, Number(query.limit) || 10)), cacheKey = key(page, limit);
        try { const raw = await RedisClient.getInstance().get(cacheKey); if (raw) { try { return JSON.parse(raw); } catch { try { await RedisClient.getInstance().del(cacheKey); } catch {} } } } catch { console.warn('Unable to read mobile ads cache'); }
        const now = new Date(); const { data, count } = await adsService.getPaginated({ main_match: publicAdsMatch(now), page, limit, sort: PATIENT_AD_SORT });
        const response = { error: false, message: 'تم جلب الإعلانات بنجاح', data: data.map(mobileAd), pagination: { page, limit, total: count, pages: Math.ceil(count / limit), hasNext: page < Math.ceil(count / limit), hasPrev: page > 1 } };
        try { await RedisClient.getInstance().set(cacheKey, JSON.stringify(response), MOBILE_ADS_CACHE_TTL_SECONDS); } catch { console.warn('Unable to write mobile ads cache'); }
        return response;
    }, { query: t.Object({ page: t.Optional(t.String()), limit: t.Optional(t.String()) }, { additionalProperties: false }), response: { 200: GenericPaginatedResponseSchema, ...PublicApiErrorResponses } })
    .get('/:id', async ({ params, set }) => {
        if (!ObjectId.isValid(params.id)) { set.status = 400; return { error: true, message: 'معرف الإعلان غير صالح' }; }
        const ad = await adsService.getPublicById(params.id, new Date());
        if (!ad) { set.status = 404; return { error: true, message: 'الإعلان غير موجود' }; }
        return { error: false, message: 'تم جلب الإعلان بنجاح', data: mobileAd(ad) };
    }, { params: t.Object({ id: t.String() }), response: { 200: GenericDataResponseSchema, 400: BadRequestResponseSchema, 404: NotFoundResponseSchema, ...PublicApiErrorResponses } });
