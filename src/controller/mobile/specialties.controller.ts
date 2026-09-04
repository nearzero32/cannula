import Elysia, { t } from 'elysia';
import { SWAGGER_TAGS } from '../../constants/swagger-tags';
import mongoose from 'mongoose';
import specialtyService, { mobileSpecialtiesCacheKey, MOBILE_SPECIALTIES_CACHE_TTL_SECONDS, PATIENT_SPECIALTY_SORT } from '../../services/specialty.service';
import { ISpecialtyStatusEnum, type ISpecialty } from '../../interfaces/specialty.interface';
import { BadRequestResponseSchema, GenericDataResponseSchema, GenericPaginatedResponseSchema, NotFoundResponseSchema, PublicApiErrorResponses } from '../../schemas/api-response.schema';
import { safeSearchPattern } from '../../services/search-safety.service';
import RedisClient from '../../databases/redis';

const ObjectId = mongoose.Types.ObjectId;

function formatSpecialtyForMobile(specialty: ISpecialty & { _id: unknown }) {
    return {
        _id: String(specialty._id),
        name: specialty.name,
        description: specialty.description,
        icon: specialty.icon,
    };
}

export const mobileSpecialtiesController = new Elysia({
    prefix: '/specialties',
    detail: { tags: [SWAGGER_TAGS.MOBILE.SPECIALTIES] },
})

    .get(
        '/',
        async ({ query }) => {
            const page = Math.max(1, Number(query.page) || 1);
            const limit = Math.min(100, Math.max(1, Number(query.limit) || 10));
            const normalizedSearch = (query.search ?? '').trim().toLowerCase();
            const cacheKey = mobileSpecialtiesCacheKey(page, limit, normalizedSearch);
            try {
                const raw = await RedisClient.getInstance().get(cacheKey);
                if (raw) {
                    try { return JSON.parse(raw); }
                    catch { try { await RedisClient.getInstance().del(cacheKey); } catch {} }
                }
            } catch { console.warn('Unable to read mobile specialties cache'); }

            const main_match: Record<string, unknown> = {
                status: ISpecialtyStatusEnum.ACTIVE,
            };

            if (normalizedSearch) {
                const search = safeSearchPattern(normalizedSearch);
                main_match.$or = [
                    { name: { $regex: search, $options: 'i' } },
                    { description: { $regex: search, $options: 'i' } },
                ];
            }

            const { data, count } = await specialtyService.getPaginated({ main_match, page, limit, sort: PATIENT_SPECIALTY_SORT });
            const totalPages = Math.ceil(count / limit);

            const response = {
                error: false,
                message: 'تم جلب التخصصات بنجاح',
                data: data.map((specialty) => formatSpecialtyForMobile(specialty)),
                pagination: { page, limit, total: count, pages: totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
            };
            try { await RedisClient.getInstance().set(cacheKey, JSON.stringify(response), MOBILE_SPECIALTIES_CACHE_TTL_SECONDS); }
            catch { console.warn('Unable to write mobile specialties cache'); }
            return response;
        },
        {
            query: t.Object({
                page: t.Optional(t.String()),
                limit: t.Optional(t.String()),
                search: t.Optional(t.String()),
            }, { additionalProperties: false }),
            response: { 200: GenericPaginatedResponseSchema, ...PublicApiErrorResponses },
        }
    )

    .get(
        '/:id',
        async ({ params, set }) => {
            if (!ObjectId.isValid(params.id)) {
                set.status = 400;
                return { error: true, message: 'معرف التخصص غير صالح' };
            }

            const specialty = await specialtyService.getById(params.id);
            if (!specialty || specialty.status !== ISpecialtyStatusEnum.ACTIVE) {
                set.status = 404;
                return { error: true, message: 'التخصص غير موجود' };
            }

            return {
                error: false,
                message: 'تم جلب التخصص بنجاح',
                data: formatSpecialtyForMobile(specialty),
            };
        },
        {
            params: t.Object({ id: t.String() }),
            response: { 200: GenericDataResponseSchema, 400: BadRequestResponseSchema, 404: NotFoundResponseSchema, ...PublicApiErrorResponses },
        }
    );
