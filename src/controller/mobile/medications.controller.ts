import Elysia from 'elysia';
import { AuthPlugin } from '../../middleware/auth.middleware';
import { TokenAudienceEnum } from '../../constants/jwt';
import { SWAGGER_TAGS } from '../../constants/swagger-tags';
import patientService from '../../services/patient.service';
import patientMedicationService from '../../services/patient-medication.service';
import { DomainError } from '../../services/domain-error';
import { MedicationCreateBodySchema, MedicationListResponseSchema, MedicationResponseSchema, MedicationUpdateBodySchema } from '../../schemas/medication-response.schema';
import { BadRequestResponseSchema, ConflictResponseSchema, ForbiddenResponseSchema, NotFoundResponseSchema, ProtectedApiErrorResponses, ValidationErrorResponseSchema } from '../../schemas/api-response.schema';

const errors = { 400: BadRequestResponseSchema, 403: ForbiddenResponseSchema, 404: NotFoundResponseSchema, 409: ConflictResponseSchema, 422: ValidationErrorResponseSchema, ...ProtectedApiErrorResponses };
async function patientFor(userId: string) { const patient = await patientService.getByUserId(userId); if (!patient) throw new DomainError('الملف الشخصي غير موجود', 404); return patient; }

export const mobileMedicationsController = new Elysia({ prefix: '/medications', detail: { tags: [SWAGGER_TAGS.MOBILE.MEDICATIONS] } })
    .use(AuthPlugin(TokenAudienceEnum.MOBILE))
    .onError(({ error, set }) => { if (error instanceof DomainError) { set.status = error.status; return { error: true, message: error.message, code: error.code }; } })
    .get('/', async ({ phrase }) => ({ error: false, message: 'تم جلب الأدوية بنجاح', data: await patientMedicationService.list((await patientFor(phrase._id))._id) }), { response: { 200: MedicationListResponseSchema, ...errors } })
    .post('/', async ({ phrase, body, set }) => { const medication = await patientMedicationService.create((await patientFor(phrase._id))._id, body); set.status = 201; return { error: false, message: 'تمت إضافة الدواء بنجاح', data: await patientMedicationService.get(medication.patient_id, String(medication._id)) }; }, { body: MedicationCreateBodySchema, detail: { description: 'ينشئ دواءً وجدولاً يحدده المريض. لا يستنتج الخادم الجرعة طبياً.' }, response: { 201: MedicationResponseSchema, ...errors } })
    .get('/:id', async ({ phrase, params }) => ({ error: false, message: 'تم جلب الدواء بنجاح', data: await patientMedicationService.get((await patientFor(phrase._id))._id, params.id) }), { response: { 200: MedicationResponseSchema, ...errors } })
    .patch('/:id', async ({ phrase, params, body }) => ({ error: false, message: 'تم تحديث الدواء بنجاح', data: await patientMedicationService.update((await patientFor(phrase._id))._id, params.id, body) }), { body: MedicationUpdateBodySchema, detail: { description: 'تغيير الجدول أو تفعيل التذكير يزيد schedule_version ويلغي الجرعات المحلية القديمة.' }, response: { 200: MedicationResponseSchema, ...errors } })
    .delete('/:id', async ({ phrase, params }) => ({ error: false, message: 'تمت أرشفة الدواء بنجاح', data: await patientMedicationService.archive((await patientFor(phrase._id))._id, params.id) }), { detail: { description: 'أرشفة منطقية تحفظ السجل وتلغي الجرعات والإشعارات المستقبلية.' }, response: { 200: MedicationResponseSchema, ...errors } });

