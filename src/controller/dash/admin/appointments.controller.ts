import Elysia, { t } from 'elysia';
import mongoose from 'mongoose';
import { AuthPlugin } from '../../../middleware/auth.middleware';
import appointmentService from '../../../services/appointment.service';
import { IAppointmentStatusEnum } from '../../../interfaces/appointment.interface';

const ObjectId = mongoose.Types.ObjectId;

export const appointmentsController = new Elysia({ prefix: '/appointments' })
    .use(AuthPlugin)

    .get(
        '/',
        async ({ query }) => {
            const page = Math.max(1, Number(query.page) || 1);
            const limit = Math.min(100, Math.max(1, Number(query.limit) || 10));

            const main_match: Record<string, unknown> = {};

            if (query.doctor_id && ObjectId.isValid(query.doctor_id)) {
                main_match.doctor_id = new ObjectId(query.doctor_id);
            }

            if (query.patient_id && ObjectId.isValid(query.patient_id)) {
                main_match.patient_id = new ObjectId(query.patient_id);
            }

            if (query.clinic_id && ObjectId.isValid(query.clinic_id)) {
                main_match.clinic_id = new ObjectId(query.clinic_id);
            }

            if (query.status) main_match.status = query.status;

            if (query.dateFrom || query.dateTo) {
                const date: Record<string, Date> = {};
                if (query.dateFrom) date.$gte = new Date(query.dateFrom);
                if (query.dateTo) date.$lte = new Date(query.dateTo);
                main_match.date = date;
            }

            if (query.search) {
                main_match.$or = [
                    { notes: { $regex: query.search, $options: 'i' } },
                    { cancellation_reason: { $regex: query.search, $options: 'i' } },
                ];
            }

            const { data, count } = await appointmentService.getPaginated({ main_match, page, limit });
            const totalPages = Math.ceil(count / limit);

            return {
                error: false,
                message: 'تم جلب المواعيد بنجاح',
                data,
                pagination: { page, limit, total: count, pages: totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
            };
        },
        {
            query: t.Object({
                page: t.Optional(t.String()),
                limit: t.Optional(t.String()),
                doctor_id: t.Optional(t.String()),
                patient_id: t.Optional(t.String()),
                clinic_id: t.Optional(t.String()),
                status: t.Optional(t.Enum(IAppointmentStatusEnum)),
                dateFrom: t.Optional(t.String()),
                dateTo: t.Optional(t.String()),
                search: t.Optional(t.String()),
            }),
        }
    )

    .get(
        '/:id',
        async ({ params, set }) => {
            if (!ObjectId.isValid(params.id)) {
                set.status = 400;
                return { error: true, message: 'معرف الموعد غير صالح' };
            }

            const appointment = await appointmentService.getById(params.id);
            if (!appointment) {
                set.status = 404;
                return { error: true, message: 'الموعد غير موجود' };
            }

            return { error: false, message: 'تم جلب الموعد بنجاح', data: appointment };
        },
        { params: t.Object({ id: t.String() }) }
    )

    .patch(
        '/:id/status',
        async ({ params, body, phrase, set }) => {
            if (!ObjectId.isValid(params.id)) {
                set.status = 400;
                return { error: true, message: 'معرف الموعد غير صالح' };
            }

            const appointment = await appointmentService.getById(params.id);
            if (!appointment) {
                set.status = 404;
                return { error: true, message: 'الموعد غير موجود' };
            }

            const updated = await appointmentService.update(params.id, { status: body.status }, {
                user_id: phrase._id,
                user_name: phrase.role + '_' + phrase._id,
                user_type: phrase.role,
                endpoint: '/dash/admin/appointments/' + params.id + '/status',
                source: 'dashboard',
            });
            return { error: false, message: 'تم تحديث حالة الموعد بنجاح', data: updated };
        },
        {
            params: t.Object({ id: t.String() }),
            body: t.Object({ status: t.Enum(IAppointmentStatusEnum) }),
        }
    );
