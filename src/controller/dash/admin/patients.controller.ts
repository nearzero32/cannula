import Elysia, { t } from 'elysia';
import mongoose from 'mongoose';
import { AuthPlugin } from '../../../middleware/auth.middleware';
import patientService from '../../../services/patient.service';
import { IPatientStatusEnum, IPatientGenderEnum, IPatientBloodGroupEnum } from '../../../interfaces/patient.interface';

const ObjectId = mongoose.Types.ObjectId;

const patientBodySchema = t.Object({
    user_id: t.String({ minLength: 1 }),
    full_name: t.String({ minLength: 1, maxLength: 120 }),
    gender: t.Optional(t.Nullable(t.Enum(IPatientGenderEnum))),
    date_of_birth: t.Optional(t.Nullable(t.String())),
    phone: t.Optional(t.Nullable(t.String({ maxLength: 30 }))),
    address: t.Optional(t.Nullable(t.String({ maxLength: 300 }))),
    profile_photo: t.Optional(t.Nullable(t.String())),
    blood_group: t.Optional(t.Nullable(t.Enum(IPatientBloodGroupEnum))),
});

export const patientsController = new Elysia({ prefix: '/patients' })
    .use(AuthPlugin)

    .get(
        '/',
        async ({ query }) => {
            const page = Math.max(1, Number(query.page) || 1);
            const limit = Math.min(100, Math.max(1, Number(query.limit) || 10));

            const main_match: Record<string, unknown> = {};

            if (query.status) main_match.status = query.status;
            if (query.search) {
                main_match.$or = [
                    { full_name: { $regex: query.search, $options: 'i' } },
                    { phone: { $regex: query.search, $options: 'i' } },
                ];
            }

            const { data, count } = await patientService.getPaginated({ main_match, page, limit });
            const totalPages = Math.ceil(count / limit);

            return {
                error: false,
                message: 'تم جلب المرضى بنجاح',
                data,
                pagination: { page, limit, total: count, pages: totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
            };
        },
        {
            query: t.Object({
                page: t.Optional(t.String()),
                limit: t.Optional(t.String()),
                status: t.Optional(t.Enum(IPatientStatusEnum)),
                search: t.Optional(t.String()),
            }),
        }
    )

    .get(
        '/:id',
        async ({ params, set }) => {
            if (!ObjectId.isValid(params.id)) {
                set.status = 400;
                return { error: true, message: 'معرف المريض غير صالح' };
            }

            const patient = await patientService.getById(params.id);
            if (!patient) {
                set.status = 404;
                return { error: true, message: 'المريض غير موجود' };
            }

            return { error: false, message: 'تم جلب المريض بنجاح', data: patient };
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

            const existing = await patientService.getByUserId(body.user_id);
            if (existing) {
                set.status = 409;
                return { error: true, message: 'هذا المستخدم مسجل كمريض مسبقاً' };
            }

            const patient = await patientService.create({
                user_id: new ObjectId(body.user_id),
                full_name: body.full_name,
                gender: body.gender,
                date_of_birth: body.date_of_birth ? new Date(body.date_of_birth) : null,
                phone: body.phone,
                address: body.address,
                profile_photo: body.profile_photo,
                blood_group: body.blood_group,
            }, {
                user_id: phrase._id,
                user_name: phrase.role + '_' + phrase._id,
                user_type: phrase.role,
                endpoint: '/dash/admin/patients',
                source: 'dashboard',
            });

            set.status = 201;
            return { error: false, message: 'تم إنشاء المريض بنجاح', data: patient };
        },
        { body: patientBodySchema }
    )

    .patch(
        '/:id/status',
        async ({ params, body, phrase, set }) => {
            if (!ObjectId.isValid(params.id)) {
                set.status = 400;
                return { error: true, message: 'معرف المريض غير صالح' };
            }

            const patient = await patientService.getById(params.id);
            if (!patient) {
                set.status = 404;
                return { error: true, message: 'المريض غير موجود' };
            }

            const updated = await patientService.update(params.id, { status: body.status }, {
                user_id: phrase._id,
                user_name: phrase.role + '_' + phrase._id,
                user_type: phrase.role,
                endpoint: '/dash/admin/patients/' + params.id + '/status',
                source: 'dashboard',
            });
            return { error: false, message: 'تم تحديث حالة المريض بنجاح', data: updated };
        },
        {
            params: t.Object({ id: t.String() }),
            body: t.Object({ status: t.Enum(IPatientStatusEnum) }),
        }
    );
