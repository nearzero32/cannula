import Elysia, { t } from 'elysia';
import mongoose from 'mongoose';
import { AuthPlugin } from '../../../middleware/auth.middleware';
import appointmentService from '../../../services/appointment.service';
import doctorService from '../../../services/doctor.service';
import {
    IAppointmentStatusEnum,
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

export const doctorAppointmentsController = new Elysia({ prefix: '/appointments' })
    .use(AuthPlugin)

    // List the doctor's own appointments
    .get(
        '/',
        async ({ query, phrase, set }) => {
            const doctor = await doctorService.getByUserId(phrase._id);
            if (!doctor) {
                set.status = 404;
                return { error: true, message: 'الملف الشخصي غير موجود' };
            }

            const page = Math.max(1, Number(query.page) || 1);
            const limit = Math.min(100, Math.max(1, Number(query.limit) || 10));

            const main_match: Record<string, unknown> = {
                doctor_id: new ObjectId((doctor._id as any).toString()),
            };

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

    // Get a single appointment (must belong to this doctor)
    .get(
        '/:id',
        async ({ params, phrase, set }) => {
            if (!ObjectId.isValid(params.id)) {
                set.status = 400;
                return { error: true, message: 'معرف الموعد غير صالح' };
            }

            const doctor = await doctorService.getByUserId(phrase._id);
            if (!doctor) {
                set.status = 404;
                return { error: true, message: 'الملف الشخصي غير موجود' };
            }

            const appointment = await appointmentService.getById(params.id);
            if (!appointment) {
                set.status = 404;
                return { error: true, message: 'الموعد غير موجود' };
            }

            if (appointment.doctor_id.toString() !== (doctor._id as any).toString()) {
                set.status = 403;
                return { error: true, message: 'غير مصرح بالوصول إلى هذا الموعد' };
            }

            return { error: false, message: 'تم جلب الموعد بنجاح', data: appointment };
        },
        { params: t.Object({ id: t.String() }) }
    )

    // Cancel appointment
    .patch(
        '/:id/cancel',
        async ({ params, body, phrase, set }) => {
            if (!ObjectId.isValid(params.id)) {
                set.status = 400;
                return { error: true, message: 'معرف الموعد غير صالح' };
            }

            const doctor = await doctorService.getByUserId(phrase._id);
            if (!doctor) {
                set.status = 404;
                return { error: true, message: 'الملف الشخصي غير موجود' };
            }

            const appointment = await appointmentService.getById(params.id);
            if (!appointment) {
                set.status = 404;
                return { error: true, message: 'الموعد غير موجود' };
            }

            if (appointment.doctor_id.toString() !== (doctor._id as any).toString()) {
                set.status = 403;
                return { error: true, message: 'غير مصرح بالوصول إلى هذا الموعد' };
            }

            const nonCancellable = [
                IAppointmentStatusEnum.CANCELLED,
                IAppointmentStatusEnum.COMPLETED,
                IAppointmentStatusEnum.NO_SHOW,
            ];
            if (nonCancellable.includes(appointment.status as any)) {
                set.status = 422;
                return { error: true, message: 'لا يمكن إلغاء هذا الموعد في حالته الحالية' };
            }

            const updated = await appointmentService.cancel(
                params.id,
                {
                    cancel_reason: body.cancel_reason ?? null,
                    cancelled_by: (doctor._id as any).toString(),
                    cancelled_by_model: IAppointmentCancelledByModelEnum.DOCTOR,
                },
                buildMeta(phrase, `/dash/doctor/appointments/${params.id}/cancel`)
            );
            return { error: false, message: 'تم إلغاء الموعد بنجاح', data: updated };
        },
        {
            params: t.Object({ id: t.String() }),
            body: t.Object({
                cancel_reason: t.Optional(t.Nullable(t.String({ maxLength: 1000 }))),
            }),
        }
    )

    // Check in patient
    .patch(
        '/:id/check-in',
        async ({ params, phrase, set }) => {
            if (!ObjectId.isValid(params.id)) {
                set.status = 400;
                return { error: true, message: 'معرف الموعد غير صالح' };
            }

            const doctor = await doctorService.getByUserId(phrase._id);
            if (!doctor) {
                set.status = 404;
                return { error: true, message: 'الملف الشخصي غير موجود' };
            }

            const appointment = await appointmentService.getById(params.id);
            if (!appointment) {
                set.status = 404;
                return { error: true, message: 'الموعد غير موجود' };
            }

            if (appointment.doctor_id.toString() !== (doctor._id as any).toString()) {
                set.status = 403;
                return { error: true, message: 'غير مصرح بالوصول إلى هذا الموعد' };
            }

            const allowedStatuses = [
                IAppointmentStatusEnum.PENDING,
                IAppointmentStatusEnum.CONFIRMED,
            ];
            if (!allowedStatuses.includes(appointment.status as any)) {
                set.status = 422;
                return { error: true, message: 'لا يمكن تسجيل وصول المريض في هذه المرحلة' };
            }

            const updated = await appointmentService.checkIn(
                params.id,
                buildMeta(phrase, `/dash/doctor/appointments/${params.id}/check-in`)
            );
            return { error: false, message: 'تم تسجيل وصول المريض بنجاح', data: updated };
        },
        { params: t.Object({ id: t.String() }) }
    )

    // Complete appointment
    .patch(
        '/:id/complete',
        async ({ params, phrase, set }) => {
            if (!ObjectId.isValid(params.id)) {
                set.status = 400;
                return { error: true, message: 'معرف الموعد غير صالح' };
            }

            const doctor = await doctorService.getByUserId(phrase._id);
            if (!doctor) {
                set.status = 404;
                return { error: true, message: 'الملف الشخصي غير موجود' };
            }

            const appointment = await appointmentService.getById(params.id);
            if (!appointment) {
                set.status = 404;
                return { error: true, message: 'الموعد غير موجود' };
            }

            if (appointment.doctor_id.toString() !== (doctor._id as any).toString()) {
                set.status = 403;
                return { error: true, message: 'غير مصرح بالوصول إلى هذا الموعد' };
            }

            const allowedStatuses = [
                IAppointmentStatusEnum.CONFIRMED,
                IAppointmentStatusEnum.CHECKED_IN,
                IAppointmentStatusEnum.IN_PROGRESS,
            ];
            if (!allowedStatuses.includes(appointment.status as any)) {
                set.status = 422;
                return { error: true, message: 'لا يمكن إنهاء هذا الموعد في حالته الحالية' };
            }

            const updated = await appointmentService.complete(
                params.id,
                buildMeta(phrase, `/dash/doctor/appointments/${params.id}/complete`)
            );
            return { error: false, message: 'تم إنهاء الموعد بنجاح', data: updated };
        },
        { params: t.Object({ id: t.String() }) }
    )

    // Mark as no-show
    .patch(
        '/:id/no-show',
        async ({ params, phrase, set }) => {
            if (!ObjectId.isValid(params.id)) {
                set.status = 400;
                return { error: true, message: 'معرف الموعد غير صالح' };
            }

            const doctor = await doctorService.getByUserId(phrase._id);
            if (!doctor) {
                set.status = 404;
                return { error: true, message: 'الملف الشخصي غير موجود' };
            }

            const appointment = await appointmentService.getById(params.id);
            if (!appointment) {
                set.status = 404;
                return { error: true, message: 'الموعد غير موجود' };
            }

            if (appointment.doctor_id.toString() !== (doctor._id as any).toString()) {
                set.status = 403;
                return { error: true, message: 'غير مصرح بالوصول إلى هذا الموعد' };
            }

            const allowedStatuses = [
                IAppointmentStatusEnum.PENDING,
                IAppointmentStatusEnum.CONFIRMED,
            ];
            if (!allowedStatuses.includes(appointment.status as any)) {
                set.status = 422;
                return { error: true, message: 'لا يمكن تسجيل الغياب في هذه المرحلة' };
            }

            const updated = await appointmentService.noShow(
                params.id,
                buildMeta(phrase, `/dash/doctor/appointments/${params.id}/no-show`)
            );
            return { error: false, message: 'تم تسجيل غياب المريض بنجاح', data: updated };
        },
        { params: t.Object({ id: t.String() }) }
    )

    // Update internal notes
    .patch(
        '/:id/notes',
        async ({ params, body, phrase, set }) => {
            if (!ObjectId.isValid(params.id)) {
                set.status = 400;
                return { error: true, message: 'معرف الموعد غير صالح' };
            }

            const doctor = await doctorService.getByUserId(phrase._id);
            if (!doctor) {
                set.status = 404;
                return { error: true, message: 'الملف الشخصي غير موجود' };
            }

            const appointment = await appointmentService.getById(params.id);
            if (!appointment) {
                set.status = 404;
                return { error: true, message: 'الموعد غير موجود' };
            }

            if (appointment.doctor_id.toString() !== (doctor._id as any).toString()) {
                set.status = 403;
                return { error: true, message: 'غير مصرح بالوصول إلى هذا الموعد' };
            }

            const updated = await appointmentService.update(
                params.id,
                { notes_internal: body.notes_internal ?? null },
                buildMeta(phrase, `/dash/doctor/appointments/${params.id}/notes`)
            );
            return { error: false, message: 'تم تحديث الملاحظات بنجاح', data: updated };
        },
        {
            params: t.Object({ id: t.String() }),
            body: t.Object({
                notes_internal: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
            }),
        }
    );
