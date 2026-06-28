import Elysia, { t } from 'elysia';
import { AuthPlugin } from '../../../middleware/auth.middleware';
import mongoose from 'mongoose';
import secretaryService from '../../../services/secretary.service';
import { ISecretaryPermissionEnum, ISecretaryStatusEnum } from '../../../interfaces/secretary.interface';

const ObjectId = mongoose.Types.ObjectId;

const secretaryBodySchema = t.Object({
    user_id: t.String({ minLength: 1 }),
    full_name: t.String({ minLength: 1, maxLength: 120 }),
    clinic_id: t.Optional(t.Nullable(t.String())),
    permissions: t.Optional(t.Array(t.Enum(ISecretaryPermissionEnum))),
    notes_internal: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
});

export const doctorSecretaryController = new Elysia({ prefix: '/secretaries' })
    .use(AuthPlugin())

    .get(
        '/',
        async ({ query, phrase }) => {
            const page = Math.max(1, Number(query.page) || 1);
            const limit = Math.min(100, Math.max(1, Number(query.limit) || 10));

            const main_match: Record<string, unknown> = {
                doctor_ids: new ObjectId(phrase._id),
            };

            if (query.status) main_match.status = query.status;
            if (query.search) {
                main_match.$or = [
                    { full_name: { $regex: query.search, $options: 'i' } },
                ];
            }

            const { data, count } = await secretaryService.getPaginated({ main_match, page, limit });
            const totalPages = Math.ceil(count / limit);

            return {
                error: false,
                message: 'تم جلب السكرتارية بنجاح',
                data,
                pagination: { page, limit, total: count, pages: totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
            };
        },
        {
            query: t.Object({
                page: t.Optional(t.String()),
                limit: t.Optional(t.String()),
                status: t.Optional(t.Enum(ISecretaryStatusEnum)),
                search: t.Optional(t.String()),
            }),
        }
    )

    .get(
        '/:id',
        async ({ params, phrase, set }) => {
            if (!ObjectId.isValid(params.id)) {
                set.status = 400;
                return { error: true, message: 'معرف السكرتير غير صالح' };
            }

            const secretary = await secretaryService.getById(params.id);
            if (!secretary) {
                set.status = 404;
                return { error: true, message: 'السكرتير غير موجود' };
            }

            const belongsToDoctor = secretary.doctor_ids.some((id) => id.toString() === phrase._id);
            if (!belongsToDoctor) {
                set.status = 403;
                return { error: true, message: 'غير مصرح لك بعرض هذا السكرتير' };
            }

            return { error: false, message: 'تم جلب السكرتير بنجاح', data: secretary };
        },
        { params: t.Object({ id: t.String() }) }
    )

    .post(
        '/',
        async ({ body, phrase, set }) => {
            if (!ObjectId.isValid(body.user_id)) {
                set.status = 400;
                return { error: true, message: 'معرف المستخدم غير صالح' };
            }

            if (body.clinic_id && !ObjectId.isValid(body.clinic_id)) {
                set.status = 400;
                return { error: true, message: 'معرف العيادة غير صالح' };
            }

            const existing = await secretaryService.getByUserId(body.user_id);
            if (existing) {
                set.status = 409;
                return { error: true, message: 'هذا المستخدم مسجل كسكرتير مسبقاً' };
            }

            const secretary = await secretaryService.create({
                user_id: new ObjectId(body.user_id),
                full_name: body.full_name,
                clinic_id: body.clinic_id ? new ObjectId(body.clinic_id) : undefined,
                doctor_ids: [new ObjectId(phrase._id)],
                permissions: body.permissions,
                notes_internal: body.notes_internal,
                created_by: new ObjectId(phrase._id),
            }, {
                user_id: phrase._id,
                user_name: phrase.role + '_' + phrase._id,
                user_type: phrase.role,
                endpoint: '/dash/doctor/secretaries',
                source: 'dashboard',
            });

            set.status = 201;
            return { error: false, message: 'تم إنشاء السكرتير بنجاح', data: secretary };
        },
        { body: secretaryBodySchema }
    )

    .patch(
        '/:id',
        async ({ params, body, phrase, set }) => {
            if (!ObjectId.isValid(params.id)) {
                set.status = 400;
                return { error: true, message: 'معرف السكرتير غير صالح' };
            }

            const secretary = await secretaryService.getById(params.id);
            if (!secretary) {
                set.status = 404;
                return { error: true, message: 'السكرتير غير موجود' };
            }

            const belongsToDoctor = secretary.doctor_ids.some((id) => id.toString() === phrase._id);
            if (!belongsToDoctor) {
                set.status = 403;
                return { error: true, message: 'غير مصرح لك بتعديل هذا السكرتير' };
            }

            const payload: Record<string, unknown> = { ...body };
            if (body.clinic_id !== undefined) {
                if (body.clinic_id && !ObjectId.isValid(body.clinic_id)) {
                    set.status = 400;
                    return { error: true, message: 'معرف العيادة غير صالح' };
                }
                payload.clinic_id = body.clinic_id ? new ObjectId(body.clinic_id) : null;
            }

            const updated = await secretaryService.update(params.id, payload, {
                user_id: phrase._id,
                user_name: phrase.role + '_' + phrase._id,
                user_type: phrase.role,
                endpoint: '/dash/doctor/secretaries/' + params.id,
                source: 'dashboard',
            });
            return { error: false, message: 'تم تحديث السكرتير بنجاح', data: updated };
        },
        {
            params: t.Object({ id: t.String() }),
            body: t.Partial(secretaryBodySchema),
        }
    )

    .patch(
        '/:id/status',
        async ({ params, body, phrase, set }) => {
            if (!ObjectId.isValid(params.id)) {
                set.status = 400;
                return { error: true, message: 'معرف السكرتير غير صالح' };
            }

            const secretary = await secretaryService.getById(params.id);
            if (!secretary) {
                set.status = 404;
                return { error: true, message: 'السكرتير غير موجود' };
            }

            const belongsToDoctor = secretary.doctor_ids.some((id) => id.toString() === phrase._id);
            if (!belongsToDoctor) {
                set.status = 403;
                return { error: true, message: 'غير مصرح لك بتعديل هذا السكرتير' };
            }

            const updated = await secretaryService.updateStatus(params.id, body.status, {
                user_id: phrase._id,
                user_name: phrase.role + '_' + phrase._id,
                user_type: phrase.role,
                endpoint: '/dash/doctor/secretaries/' + params.id + '/status',
                source: 'dashboard',
            });
            return { error: false, message: 'تم تحديث حالة السكرتير بنجاح', data: updated };
        },
        {
            params: t.Object({ id: t.String() }),
            body: t.Object({ status: t.Enum(ISecretaryStatusEnum) }),
        }
    );
