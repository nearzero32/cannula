import Elysia, { t } from 'elysia';
import { SWAGGER_TAGS } from '../../constants/swagger-tags';
import mongoose from 'mongoose';
import chronicConditionService from '../../services/chronic-condition.service';
import { IChronicConditionStatusEnum } from '../../interfaces/chronic-condition.interface';
import { GenericPaginatedResponseSchema, PublicApiErrorResponses } from '../../schemas/api-response.schema';

export const mobileChronicConditionsController = new Elysia({
    prefix: '/chronic-conditions',
    detail: { tags: [SWAGGER_TAGS.MOBILE.CHRONIC_CONDITIONS] },
})

    .get(
        '/',
        async ({ query }) => {
            const page = Math.max(1, Number(query.page) || 1);
            const limit = Math.min(100, Math.max(1, Number(query.limit) || 10));

            const main_match: Record<string, unknown> = {
                status: IChronicConditionStatusEnum.ACTIVE,
            };

            if (query.search) {
                main_match.$or = [
                    { name: { $regex: query.search, $options: 'i' } },
                    { description: { $regex: query.search, $options: 'i' } },
                ];
            }

            const { data, count } = await chronicConditionService.getPaginated({ main_match, page, limit });
            const totalPages = Math.ceil(count / limit);

            return {
                error: false,
                message: 'تم جلب الأمراض المزمنة بنجاح',
                data,
                pagination: { page, limit, total: count, pages: totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
            };
        },
        {
            query: t.Object({
                page: t.Optional(t.String()),
                limit: t.Optional(t.String()),
                search: t.Optional(t.String()),
            }),
            response: { 200: GenericPaginatedResponseSchema, ...PublicApiErrorResponses },
        }
    )
