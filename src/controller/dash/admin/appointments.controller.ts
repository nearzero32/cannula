import Elysia, { t } from 'elysia';
import { AuthPlugin } from '../../../middleware/auth.middleware';
import mongoose from 'mongoose';
import appointmentService from '../../../services/appointment.service';
import {
    IAppointmentStatusEnum,
    IAppointmentBookingSourceEnum,
    IAppointmentPaymentStatusEnum,
    IAppointmentCancelledByModelEnum,
} from '../../../interfaces/appointment.interface';

const ObjectId = mongoose.Types.ObjectId;

const buildMeta = (phrase: any, endpoint: string) => ({
    user_id: phrase._id,
    user_name: `${phrase.role}_${phrase._id}`,
    user_type: phrase.role,
    endpoint,
    source: 'dashboard',
});

export const appointmentsController = new Elysia({ prefix: '/appointments' })
    .use(AuthPlugin())

    // List appointments with filters
    .get(
        '/',
        async ({ query }) => {
            const page = Math.max(1, Number(query.page) || 1);
            const limit = Math.min(100, Math.max(1, Number(query.limit) || 10));

            const main_match: Record<string, unknown> = {};

            if (query.doctor_id && ObjectId.isValid(query.doctor_id))
                main_match.doctor_id = new ObjectId(query.doctor_id);

            if (query.patient_id && ObjectId.isValid(query.patient_id))
                main_match.patient_id = new ObjectId(query.patient_id);

            if (query.clinic_id && ObjectId.isValid(query.clinic_id))
                main_match.clinic_id = new ObjectId(query.clinic_id);

            if (query.status) main_match.status = query.status;
            if (query.payment_status) main_match.payment_status = query.payment_status;

            if (query.dateFrom || query.dateTo) {
                const dateFilter: Record<string, Date> = {};
                if (query.dateFrom) dateFilter.$gte = new Date(query.dateFrom);
                if (query.dateTo) dateFilter.$lte = new Date(query.dateTo);
                main_match.date = dateFilter;
            }

            if (query.search) {
                main_match.$or = [
                    { appointment_number: { $regex: query.search, $options: 'i' } },
                    { reason: { $regex: query.search, $options: 'i' } },
                    { cancel_reason: { $regex: query.search, $options: 'i' } },
                ];
            }

            const { data, count } = await appointmentService.getPaginated({
                main_match,
                page,
                limit,
            });
            const totalPages = Math.ceil(count / limit);

            return {
                error: false,
                message: 'تم جلب المواعيد بنجاح',
                data,
                pagination: {
                    page,
                    limit,
                    total: count,
                    pages: totalPages,
                    hasNext: page < totalPages,
                    hasPrev: page > 1,
                },
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
                payment_status: t.Optional(t.Enum(IAppointmentPaymentStatusEnum)),
                dateFrom: t.Optional(t.String()),
                dateTo: t.Optional(t.String()),
                search: t.Optional(t.String()),
            }),
        }
    )

    // Get appointment by ID
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

