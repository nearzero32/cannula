import Elysia, { t } from 'elysia';
import { SWAGGER_TAGS } from '../../../constants/swagger-tags';
import { AuthPlugin } from '../../../middleware/auth.middleware';
import mongoose from 'mongoose';
import specialtyService from '../../../services/specialty.service';
import { ISpecialtyStatusEnum } from '../../../interfaces/specialty.interface';
import { BadRequestResponseSchema, GenericDataResponseSchema, GenericPaginatedResponseSchema, NotFoundResponseSchema, ProtectedApiErrorResponses, ValidationErrorResponseSchema } from '../../../schemas/api-response.schema';
import { AdminPermissionGuardPlugin } from '../../../middleware/authorization.middleware';
import { IAdminPermissionEnum } from '../../../interfaces/admin.interface';

const ObjectId = mongoose.Types.ObjectId;

const specialtyBodySchema = t.Object({
    name: t.String({ minLength: 1, maxLength: 150 }),
    description: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
    icon: t.Optional(t.Nullable(t.String())),
    sortOrder: t.Optional(t.Number({ minimum: 0 })),
    status: t.Optional(t.Enum(ISpecialtyStatusEnum)),
});

export const specialtiesController = new Elysia({
    prefix: '/specialties',
    detail: { tags: [SWAGGER_TAGS.ADMIN.SPECIALTIES] },
})
    .use(AuthPlugin())
    .use(AdminPermissionGuardPlugin(IAdminPermissionEnum.MANAGE_SPECIALTIES))

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

            const { data, count } = await specialtyService.getPaginated({ main_match, page, limit });
            const totalPages = Math.ceil(count / limit);

            return {
                error: false,
                message: 'تم جلب التخصصات بنجاح',
                data,
                pagination: { page, limit, total: count, pages: totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
            };
        },
        {
            query: t.Object({
                page: t.Optional(t.String()),
                limit: t.Optional(t.String()),
                status: t.Optional(t.Enum(ISpecialtyStatusEnum)),
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
                return { error: true, message: 'معرف التخصص غير صالح' };
            }

            const specialty = await specialtyService.getById(params.id);
            if (!specialty) {
                set.status = 404;
                return { error: true, message: 'التخصص غير موجود' };
            }

            return { error: false, message: 'تم جلب التخصص بنجاح', data: specialty };
        },
        {
            params: t.Object({ id: t.String() }),
            response: { 200: GenericDataResponseSchema, 400: BadRequestResponseSchema, 404: NotFoundResponseSchema, ...ProtectedApiErrorResponses },
        }
    )

    .post(
        '/',
        async ({ body, phrase, set }) => {
            const specialty = await specialtyService.create({
                name: body.name,
                description: body.description,
                icon: body.icon,
                status: body.status ?? ISpecialtyStatusEnum.ACTIVE,
                sort_order: body.sortOrder ?? 0,
                created_by: new ObjectId(phrase._id),
            }, {
                user_id: phrase._id,
                user_name: phrase.role + '_' + phrase._id,
                user_type: phrase.role,
                endpoint: '/dash/specialties',
                source: 'dashboard',
            });

            set.status = 201;
            return { error: false, message: 'تم إنشاء التخصص بنجاح', data: specialty };
        },
        {
            body: specialtyBodySchema,
            response: { 201: GenericDataResponseSchema, 400: BadRequestResponseSchema, 422: ValidationErrorResponseSchema, ...ProtectedApiErrorResponses },
        }
    )

    .put(
        '/:id',
        async ({ params, body, phrase, set }) => {
            if (!ObjectId.isValid(params.id)) {
                set.status = 400;
                return { error: true, message: 'معرف التخصص غير صالح' };
            }

            const specialty = await specialtyService.getById(params.id);
            if (!specialty) {
                set.status = 404;
                return { error: true, message: 'التخصص غير موجود' };
            }

            const payload: Record<string, unknown> = {};
            if (body.name !== undefined) payload.name = body.name;
            if (body.description !== undefined) payload.description = body.description;
            if (body.icon !== undefined) payload.icon = body.icon;
            if (body.sortOrder !== undefined) payload.sort_order = body.sortOrder;

            const updated = await specialtyService.update(params.id, payload, {
                user_id: phrase._id,
                user_name: phrase.role + '_' + phrase._id,
                user_type: phrase.role,
                endpoint: '/dash/specialties/' + params.id,
                source: 'dashboard',
            });
            return { error: false, message: 'تم تحديث التخصص بنجاح', data: updated };
        },
        {
            params: t.Object({ id: t.String() }),
            body: t.Partial(specialtyBodySchema),
            response: { 200: GenericDataResponseSchema, 400: BadRequestResponseSchema, 404: NotFoundResponseSchema, 422: ValidationErrorResponseSchema, ...ProtectedApiErrorResponses },
        }
    )

    .patch(
        '/:id/status',
        async ({ params, body, phrase, set }) => {
            if (!ObjectId.isValid(params.id)) {
                set.status = 400;
                return { error: true, message: 'معرف التخصص غير صالح' };
            }

            const specialty = await specialtyService.getById(params.id);
            if (!specialty) {
                set.status = 404;
                return { error: true, message: 'التخصص غير موجود' };
            }

            const updated = await specialtyService.updateStatus(params.id, body.status, {
                user_id: phrase._id,
                user_name: phrase.role + '_' + phrase._id,
                user_type: phrase.role,
                endpoint: '/dash/specialties/' + params.id + '/status',
                source: 'dashboard',
            });
            return { error: false, message: 'تم تحديث حالة التخصص بنجاح', data: updated };
        },
        {
            params: t.Object({ id: t.String() }),
            body: t.Object({ status: t.Enum(ISpecialtyStatusEnum) }),
            response: { 200: GenericDataResponseSchema, 400: BadRequestResponseSchema, 404: NotFoundResponseSchema, 422: ValidationErrorResponseSchema, ...ProtectedApiErrorResponses },
        }
    );
