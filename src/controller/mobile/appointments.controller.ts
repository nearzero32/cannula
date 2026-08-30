import Elysia, { t } from 'elysia';
import mongoose from 'mongoose';
import { AuthPlugin } from '../../middleware/auth.middleware';
import patientService from '../../services/patient.service';
import mobileAppointmentService, { formatMobileAppointment } from '../../services/mobile-appointment.service';
import { DomainError } from '../../services/domain-error';
import { IUserRoleEnum } from '../../interfaces/user.interface';
import {
    BadRequestResponseSchema,
    AppointmentSlotConflictResponseSchema,
    ForbiddenResponseSchema,
    NotFoundResponseSchema,
    ProtectedApiErrorResponses,
    UnprocessableEntityResponseSchema,
    ValidationErrorResponseSchema,
} from '../../schemas/api-response.schema';
import { MobileAppointmentResponseSchema } from '../../schemas/patient-health-response.schema';

const mobileAppointmentBodySchema = t.Object({
    doctor_id: t.String(),
    clinic_id: t.String(),
    specialty_id: t.Optional(t.Nullable(t.String())),
    date: t.String({ format: 'date' }),
    starts_at: t.String({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }),
    ends_at: t.String({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }),
    reason: t.Optional(t.Nullable(t.String({ maxLength: 1000 }))),
    child_id: t.Optional(t.Nullable(t.String({ description: 'اختياري؛ غيابه يعني أن الموعد للمريض نفسه' }))),
}, { additionalProperties: false });

export const mobileAppointmentsController = new Elysia({ prefix: '/appointments' })
    .use(AuthPlugin())
    .post('/', async ({ body, phrase, set }) => {
        if (phrase.role !== IUserRoleEnum.PATIENT) {
            set.status = 403;
            return { error: true, message: 'غير مصرح لك بالوصول' };
        }
        const patient = await patientService.getByUserId(phrase._id);
        if (!patient) {
            set.status = 404;
            return { error: true, message: 'الملف الشخصي غير موجود' };
        }
        try {
            const result = await mobileAppointmentService.create(
                new mongoose.Types.ObjectId(patient._id.toString()),
                phrase._id,
                body
            );
            set.status = 201;
            return {
                error: false,
                message: 'تم حجز الموعد بنجاح',
                data: formatMobileAppointment(result.appointment, result.child),
            };
        } catch (error) {
            if (error instanceof DomainError) {
                set.status = error.status;
                return { error: true, message: error.message };
            }
            throw error;
        }
    }, {
        body: mobileAppointmentBodySchema,
        response: {
            201: MobileAppointmentResponseSchema,
            400: BadRequestResponseSchema,
            403: ForbiddenResponseSchema,
            404: NotFoundResponseSchema,
            409: AppointmentSlotConflictResponseSchema,
            422: t.Union([ValidationErrorResponseSchema, UnprocessableEntityResponseSchema]),
            ...ProtectedApiErrorResponses,
        },
    });
