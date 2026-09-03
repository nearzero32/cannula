import Elysia, { t } from 'elysia';
import { AuthPlugin } from '../../middleware/auth.middleware';
import { TokenAudienceEnum } from '../../constants/jwt';
import { SWAGGER_TAGS } from '../../constants/swagger-tags';
import patientService from '../../services/patient.service';
import appointmentService, { formatAppointment } from '../../services/appointment.service';
import appointmentSlotService from '../../services/appointment-slot.service';
import appointmentWorkflowService from '../../services/appointment-workflow.service';
import { AppointmentActorTypeEnum, IAppointmentStatusEnum } from '../../interfaces/appointment.interface';
import { DomainError } from '../../services/domain-error';
import { AppointmentListResponseSchema, AppointmentResponseSchema, HistoryResponseSchema, PatientAppointmentCreateBodySchema, SlotsResponseSchema } from '../../schemas/appointment-response.schema';
import { BadRequestResponseSchema, ConflictResponseSchema, ForbiddenResponseSchema, NotFoundResponseSchema, ProtectedApiErrorResponses, ValidationOrBusinessRuleResponseSchema } from '../../schemas/api-response.schema';

const errors = { 400: BadRequestResponseSchema, 403: ForbiddenResponseSchema, 404: NotFoundResponseSchema, 409: ConflictResponseSchema, 422: ValidationOrBusinessRuleResponseSchema, ...ProtectedApiErrorResponses };
const pagination = (page: number, limit: number, total: number) => ({ page, limit, total, pages: Math.ceil(total / limit), hasNext: page * limit < total, hasPrev: page > 1 });
const destinationSchema = t.Object({ doctorId: t.Optional(t.String()), clinicId: t.Optional(t.String()), specialtyId: t.Optional(t.Nullable(t.String())), date: t.String({ format: 'date' }), startsAt: t.String({ format: 'date-time' }), reason: t.Optional(t.Nullable(t.String({ maxLength: 1000 }))) }, { additionalProperties: false });
async function patientFor(userId: string) {
    const patient = await patientService.getByUserId(userId); if (!patient) throw new DomainError('الملف الشخصي غير موجود', 404, 'APPOINTMENT_NOT_OWNED'); return patient;
}
const actor = (userId: string, patientId: string) => ({ type: AppointmentActorTypeEnum.PATIENT, userId, patientId });

export const mobileAppointmentsController = new Elysia({ prefix: '/appointments', detail: { tags: [SWAGGER_TAGS.MOBILE.APPOINTMENTS] } })
    .use(AuthPlugin(TokenAudienceEnum.MOBILE))
    .onError(({ error, set }) => { if (error instanceof DomainError) { set.status = error.status; return { error: true, message: error.message, code: error.code }; } })
    .get('/availability', async ({ query }) => {
        const result = await appointmentSlotService.getSlots({ doctorId: query.doctorId, clinicId: query.clinicId, specialtyId: query.specialtyId, date: query.date });
        return { error: false, message: 'تم جلب الأوقات المتاحة بنجاح', data: { doctorId: result.doctorId, clinicId: result.clinicId, date: result.date, timezone: result.timezone, slots: result.slots } };
    }, { query: t.Object({ doctorId: t.String(), clinicId: t.String(), specialtyId: t.Optional(t.String()), date: t.String({ format: 'date' }) }), response: { 200: SlotsResponseSchema, ...errors } })
    .get('/', async ({ query, phrase }) => {
        const patient = await patientFor(phrase._id);
        const result = await appointmentService.list({ patientId: String(patient._id), page: Number(query.page) || 1, limit: Number(query.limit) || 20, status: query.status, view: query.view });
        return { error: false, message: 'تم جلب المواعيد بنجاح', data: await appointmentService.patientDtos(result.data), pagination: pagination(result.page, result.limit, result.count) };
    }, { query: t.Object({ page: t.Optional(t.String()), limit: t.Optional(t.String()), status: t.Optional(t.Enum(IAppointmentStatusEnum)), view: t.Optional(t.Union([t.Literal('upcoming'), t.Literal('past'), t.Literal('cancelled')])) }), response: { 200: AppointmentListResponseSchema, ...errors } })
    .post('/', async ({ body, phrase, set }) => {
        const patient = await patientFor(phrase._id);
        const appointment = await appointmentWorkflowService.create({ patientId: String(patient._id), doctorId: body.doctorId, clinicId: body.clinicId, specialtyId: body.specialtyId, date: body.date, startsAt: body.startsAt, beneficiary: body.beneficiary, reason: body.reason, source: 'app', bookedByUserId: phrase._id }, actor(phrase._id, String(patient._id)));
        set.status = 201; return { error: false, message: 'تم حجز الموعد بنجاح', data: (await appointmentService.patientDtos([appointment]))[0] };
    }, { body: PatientAppointmentCreateBodySchema, response: { 201: AppointmentResponseSchema, ...errors } })
    .get('/:id', async ({ params, phrase }) => {
        const patient = await patientFor(phrase._id), appointment = await appointmentService.patientAppointment(params.id, String(patient._id));
        return { error: false, message: 'تم جلب الموعد بنجاح', data: (await appointmentService.patientDtos([appointment]))[0] };
    }, { response: { 200: AppointmentResponseSchema, ...errors } })
    .get('/:id/history', async ({ params, phrase }) => {
        const patient = await patientFor(phrase._id); await appointmentService.patientAppointment(params.id, String(patient._id));
        return { error: false, message: 'تم جلب سجل الموعد بنجاح', data: await appointmentService.history(params.id, true) };
    }, { response: { 200: HistoryResponseSchema, ...errors } })
    .post('/:id/cancel', async ({ params, body, phrase }) => {
        const patient = await patientFor(phrase._id), appointment = await appointmentWorkflowService.cancel(params.id, actor(phrase._id, String(patient._id)), body.reason);
        return { error: false, message: 'تم إلغاء الموعد بنجاح', data: (await appointmentService.patientDtos([appointment]))[0] };
    }, { body: t.Object({ reason: t.Optional(t.Nullable(t.String({ maxLength: 1000 }))) }, { additionalProperties: false }), response: { 200: AppointmentResponseSchema, ...errors } })
    .post('/:id/reschedule', async ({ params, body, phrase }) => {
        const patient = await patientFor(phrase._id), result = await appointmentWorkflowService.reschedule(params.id, body, actor(phrase._id, String(patient._id)));
        return { error: false, message: 'تمت إعادة جدولة الموعد بنجاح', data: (await appointmentService.patientDtos([result.appointment]))[0] };
    }, { body: destinationSchema, response: { 200: AppointmentResponseSchema, ...errors } });
