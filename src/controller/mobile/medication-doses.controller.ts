import Elysia from 'elysia';
import { AuthPlugin } from '../../middleware/auth.middleware';
import { TokenAudienceEnum } from '../../constants/jwt';
import { SWAGGER_TAGS } from '../../constants/swagger-tags';
import patientService from '../../services/patient.service';
import medicationDoseService from '../../services/medication-dose.service';
import { MedicationDoseStatusEnum } from '../../interfaces/medication-dose.interface';
import { DomainError } from '../../services/domain-error';
import { MedicationDoseListResponseSchema, MedicationDoseResponseSchema } from '../../schemas/medication-response.schema';
import { BadRequestResponseSchema, ConflictResponseSchema, ForbiddenResponseSchema, NotFoundResponseSchema, ProtectedApiErrorResponses } from '../../schemas/api-response.schema';

const errors = { 400: BadRequestResponseSchema, 403: ForbiddenResponseSchema, 404: NotFoundResponseSchema, 409: ConflictResponseSchema, ...ProtectedApiErrorResponses };
async function patientFor(userId: string) { const patient = await patientService.getByUserId(userId); if (!patient) throw new DomainError('الملف الشخصي غير موجود', 404); return patient; }

export const mobileMedicationDosesController = new Elysia({ prefix: '/medication-doses', detail: { tags: [SWAGGER_TAGS.MOBILE.MEDICATIONS] } })
    .use(AuthPlugin(TokenAudienceEnum.MOBILE))
    .onError(({ error, set }) => { if (error instanceof DomainError) { set.status = error.status; return { error: true, message: error.message, code: error.code }; } })
    .get('/today', async ({ phrase }) => ({ error: false, message: 'تم جلب جرعات اليوم بنجاح', data: await medicationDoseService.today((await patientFor(phrase._id))._id) }), { detail: { description: 'يستخدم حدود اليوم في Asia/Baghdad، وحالة قراءة الإشعار مستقلة عن حالة الجرعة.' }, response: { 200: MedicationDoseListResponseSchema, ...errors } })
    .patch('/:id/taken', async ({ phrase, params }) => ({ error: false, message: 'تم تسجيل تناول الجرعة بنجاح', data: await medicationDoseService.record((await patientFor(phrase._id))._id, params.id, MedicationDoseStatusEnum.TAKEN) }), { detail: { description: 'عملية idempotent تستخدم وقت الخادم. الحالات النهائية المتعارضة تعيد 409.' }, response: { 200: MedicationDoseResponseSchema, ...errors } })
    .patch('/:id/not-taken', async ({ phrase, params }) => ({ error: false, message: 'تم تسجيل عدم تناول الجرعة بنجاح', data: await medicationDoseService.record((await patientFor(phrase._id))._id, params.id, MedicationDoseStatusEnum.NOT_TAKEN) }), { detail: { description: 'عملية idempotent. لا يغيّر تجاهل الإشعار حالة الجرعة تلقائياً.' }, response: { 200: MedicationDoseResponseSchema, ...errors } });

