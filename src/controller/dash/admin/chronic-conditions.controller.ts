import Elysia, { t } from 'elysia';
import { SWAGGER_TAGS } from '../../../constants/swagger-tags';
import mongoose from 'mongoose';
import { AuthPlugin } from '../../../middleware/auth.middleware';
import chronicConditionService from '../../../services/chronic-condition.service';
import { IChronicConditionStatusEnum } from '../../../interfaces/chronic-condition.interface';
import { BadRequestResponseSchema, GenericDataResponseSchema, GenericPaginatedResponseSchema, NotFoundResponseSchema, ProtectedApiErrorResponses, ValidationErrorResponseSchema } from '../../../schemas/api-response.schema';
import { AdminPermissionGuardPlugin } from '../../../middleware/authorization.middleware';
import { IAdminPermissionEnum } from '../../../interfaces/admin.interface';

const ObjectId = mongoose.Types.ObjectId;

const chronicConditionBodySchema = t.Object({
    name: t.String({ minLength: 1, maxLength: 120 }),
    description: t.Optional(t.Nullable(t.String({ maxLength: 1000 }))),
    status: t.Optional(t.Enum(IChronicConditionStatusEnum)),
});

export const chronicConditionsController = new Elysia({
    prefix: '/chronic-conditions',
    detail: { tags: [SWAGGER_TAGS.ADMIN.CHRONIC_CONDITIONS] },
})
    .use(AuthPlugin())
    .use(AdminPermissionGuardPlugin(IAdminPermissionEnum.MANAGE_SETTINGS))

    .get(
        '/',
        async ({ query }) => {
            const page = Math.max(1, Number(query.page) || 1);
            const limit = Math.min(100, Math.max(1, Number(query.limit) || 10));

            const main_match: Record<string, unknown> = {};

            if (query.status) main_match.status = query.status;
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
                status: t.Optional(t.Enum(IChronicConditionStatusEnum)),
                search: t.Optional(t.String()),
            }),
            response: { 200: GenericPaginatedResponseSchema, 422: ValidationErrorResponseSchema, ...ProtectedApiErrorResponses },
        }
    )

    .get(
        '/:id',
        async ({ params, set }) => {
            if (!ObjectId.isValid(params.id)) {
                set.status = 400;
                return { error: true, message: 'معرف المرض المزمن غير صالح' };
            }

            const item = await chronicConditionService.getById(params.id);
            if (!item) {
                set.status = 404;
                return { error: true, message: 'المرض المزمن غير موجود' };
            }

            return { error: false, message: 'تم جلب المرض المزمن بنجاح', data: item };
        },
        {
            params: t.Object({ id: t.String() }),
            response: { 200: GenericDataResponseSchema, 400: BadRequestResponseSchema, 404: NotFoundResponseSchema, ...ProtectedApiErrorResponses },
        }
    )

    .post(
        '/',
        async ({ body, phrase, set }) => {
            const item = await chronicConditionService.create(
                {
                    name: body.name,
                    description: body.description,
                    status: body.status ?? IChronicConditionStatusEnum.ACTIVE,
                    created_by: new ObjectId(phrase._id),
                },
                {
                    user_id: phrase._id,
                    user_name: phrase.role + '_' + phrase._id,
                    user_type: phrase.role,
                    endpoint: '/dash/admin/chronic-conditions',
                    source: 'dashboard',
                }
            );

            set.status = 201;
            return { error: false, message: 'تم إنشاء المرض المزمن بنجاح', data: item };
        },
        {
            body: chronicConditionBodySchema,
            response: { 201: GenericDataResponseSchema, 400: BadRequestResponseSchema, 422: ValidationErrorResponseSchema, ...ProtectedApiErrorResponses },
        }
    )

    .put(
        '/:id',
        async ({ params, body, phrase, set }) => {
            if (!ObjectId.isValid(params.id)) {
                set.status = 400;
                return { error: true, message: 'معرف المرض المزمن غير صالح' };
            }

            const item = await chronicConditionService.getById(params.id);
            if (!item) {
                set.status = 404;
                return { error: true, message: 'المرض المزمن غير موجود' };
            }

            const payload: Record<string, unknown> = {};
            if (body.name !== undefined) payload.name = body.name;
            if (body.description !== undefined) payload.description = body.description;

            const updated = await chronicConditionService.update(params.id, payload, {
                user_id: phrase._id,
                user_name: phrase.role + '_' + phrase._id,
                user_type: phrase.role,
                endpoint: '/dash/admin/chronic-conditions/' + params.id,
                source: 'dashboard',
            });

            return { error: false, message: 'تم تحديث المرض المزمن بنجاح', data: updated };
        },
        {
            params: t.Object({ id: t.String() }),
            body: t.Partial(chronicConditionBodySchema),
            response: { 200: GenericDataResponseSchema, 400: BadRequestResponseSchema, 404: NotFoundResponseSchema, 422: ValidationErrorResponseSchema, ...ProtectedApiErrorResponses },
        }
    )

    .patch(
        '/:id/status',
        async ({ params, body, phrase, set }) => {
            if (!ObjectId.isValid(params.id)) {
                set.status = 400;
                return { error: true, message: 'معرف المرض المزمن غير صالح' };
            }

            const item = await chronicConditionService.getById(params.id);
            if (!item) {
                set.status = 404;
                return { error: true, message: 'المرض المزمن غير موجود' };
            }

            const updated = await chronicConditionService.updateStatus(params.id, body.status, {
                user_id: phrase._id,
                user_name: phrase.role + '_' + phrase._id,
                user_type: phrase.role,
                endpoint: '/dash/admin/chronic-conditions/' + params.id + '/status',
                source: 'dashboard',
            });

            return { error: false, message: 'تم تحديث حالة المرض المزمن بنجاح', data: updated };
        },
        {
            params: t.Object({ id: t.String() }),
            body: t.Object({ status: t.Enum(IChronicConditionStatusEnum) }),
            response: { 200: GenericDataResponseSchema, 400: BadRequestResponseSchema, 404: NotFoundResponseSchema, 422: ValidationErrorResponseSchema, ...ProtectedApiErrorResponses },
        }
    );
