import Elysia, { t } from 'elysia';
import { AuthPlugin } from '../../../middleware/auth.middleware';
import { IUserRoleEnum } from '../../../interfaces/user.interface';
import { INurseGenderEnum, INurseStatusEnum } from '../../../interfaces/nurse.interface';
import nurseService from '../../../services/nurse.service';
import { formatNurse } from '../../../services/nurse.formatter';
import { DomainError } from '../../../services/domain-error';
import { SWAGGER_TAGS } from '../../../constants/swagger-tags';
import { BadRequestResponseSchema, ConflictResponseSchema, ForbiddenResponseSchema, NotFoundResponseSchema, ProtectedApiErrorResponses, UnprocessableEntityResponseSchema, ValidationErrorResponseSchema } from '../../../schemas/api-response.schema';
import { NurseListResponseSchema, NurseResponseSchema } from '../../../schemas/nurse-response.schema';

const fields = {
    full_name: t.String({ minLength: 2, maxLength: 120 }), gender: t.Optional(t.Nullable(t.Enum(INurseGenderEnum))),
    profile_photo: t.Optional(t.Nullable(t.String())), specialty: t.Optional(t.Nullable(t.String({ maxLength: 160 }))),
    license_number: t.Optional(t.Nullable(t.String({ maxLength: 100 }))), license_verified: t.Optional(t.Boolean()),
    experience_years: t.Optional(t.Nullable(t.Number({ minimum: 0 }))), qualified_service_ids: t.Array(t.String()),
    status: t.Optional(t.Enum(INurseStatusEnum)), notes_internal: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
};
const createSchema = t.Object({ user_id: t.String(), ...fields }, { additionalProperties: false });
const updateSchema = t.Partial(t.Object(fields, { additionalProperties: false }));
function pageInfo(page: number, limit: number, total: number) { const pages = Math.ceil(total / limit); return { page, limit, total, pages, hasNext: page < pages, hasPrev: page > 1 }; }
function requireAdmin(role: string) { if (role !== IUserRoleEnum.ADMIN) throw new DomainError('غير مصرح لك بالوصول', 403); }

export const nursesAdminController = new Elysia({ prefix: '/nurses', detail: { tags: [SWAGGER_TAGS.ADMIN.NURSES] } })
    .use(AuthPlugin()).onError(({ error, set }) => { if (error instanceof DomainError) { set.status = error.status; return { error: true, message: error.message }; } })
    .get('/', async ({ query, phrase }) => {
        requireAdmin(phrase.role); const page = Math.max(1, Number(query.page) || 1), limit = Math.min(100, Math.max(1, Number(query.limit) || 10));
        const { data, count } = await nurseService.list({ page, limit, status: query.status, search: query.search });
        return { error: false, message: 'تم جلب الممرضين بنجاح', data: data.map(item => formatNurse(item, true)), pagination: pageInfo(page, limit, count) };
    }, { query: t.Object({ page: t.Optional(t.String()), limit: t.Optional(t.String()), status: t.Optional(t.Enum(INurseStatusEnum)), search: t.Optional(t.String()) }), response: { 200: NurseListResponseSchema, 403: ForbiddenResponseSchema, 422: t.Union([ValidationErrorResponseSchema, UnprocessableEntityResponseSchema]), ...ProtectedApiErrorResponses } })
    .get('/:id', async ({ params, phrase }) => { requireAdmin(phrase.role); const nurse = await nurseService.getById(params.id); if (!nurse) throw new DomainError('الممرض غير موجود', 404); return { error: false, message: 'تم جلب بيانات الممرض بنجاح', data: formatNurse(nurse, true) }; }, { params: t.Object({ id: t.String() }), response: { 200: NurseResponseSchema, 403: ForbiddenResponseSchema, 404: NotFoundResponseSchema, ...ProtectedApiErrorResponses } })
    .post('/', async ({ body, phrase, set }) => { requireAdmin(phrase.role); const nurse = await nurseService.create({ ...body, status: body.status ?? INurseStatusEnum.INACTIVE }, { user_id: phrase._id, endpoint: '/dash/admin/nurses' }); const populated = await nurseService.getById(String(nurse._id)); set.status = 201; return { error: false, message: 'تم إنشاء الممرض بنجاح', data: formatNurse(populated ?? nurse, true) }; }, { body: createSchema, response: { 201: NurseResponseSchema, 400: BadRequestResponseSchema, 403: ForbiddenResponseSchema, 404: NotFoundResponseSchema, 409: ConflictResponseSchema, 422: t.Union([ValidationErrorResponseSchema, UnprocessableEntityResponseSchema]), ...ProtectedApiErrorResponses } })
    .patch('/:id', async ({ params, body, phrase }) => { requireAdmin(phrase.role); const nurse = await nurseService.update(params.id, body, { user_id: phrase._id, endpoint: `/dash/admin/nurses/${params.id}` }); return { error: false, message: 'تم تحديث بيانات الممرض بنجاح', data: formatNurse(nurse, true) }; }, { params: t.Object({ id: t.String() }), body: updateSchema, response: { 200: NurseResponseSchema, 400: BadRequestResponseSchema, 403: ForbiddenResponseSchema, 404: NotFoundResponseSchema, 422: t.Union([ValidationErrorResponseSchema, UnprocessableEntityResponseSchema]), ...ProtectedApiErrorResponses } })
    .patch('/:id/status', async ({ params, body, phrase }) => { requireAdmin(phrase.role); const nurse = await nurseService.update(params.id, { status: body.status }, { user_id: phrase._id, endpoint: `/dash/admin/nurses/${params.id}/status` }); return { error: false, message: 'تم تحديث حالة الممرض بنجاح', data: formatNurse(nurse, true) }; }, { params: t.Object({ id: t.String() }), body: t.Object({ status: t.Enum(INurseStatusEnum) }), response: { 200: NurseResponseSchema, 403: ForbiddenResponseSchema, 404: NotFoundResponseSchema, 422: ValidationErrorResponseSchema, ...ProtectedApiErrorResponses } });
