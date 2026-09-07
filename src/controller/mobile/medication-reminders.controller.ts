import Elysia from 'elysia';
import { AuthPlugin } from '../../middleware/auth.middleware';
import { TokenAudienceEnum } from '../../constants/jwt';
import { SWAGGER_TAGS } from '../../constants/swagger-tags';
import patientService from '../../services/patient.service';
import medicationDoseService from '../../services/medication-dose.service';
import { DomainError } from '../../services/domain-error';
import { MedicationReminderSyncResponseSchema } from '../../schemas/medication-response.schema';
import { ForbiddenResponseSchema, NotFoundResponseSchema, ProtectedApiErrorResponses } from '../../schemas/api-response.schema';

async function patientFor(userId: string) { const patient = await patientService.getByUserId(userId); if (!patient) throw new DomainError('الملف الشخصي غير موجود', 404); return patient; }
export const mobileMedicationRemindersController = new Elysia({ prefix: '/medication-reminders', detail: { tags: [SWAGGER_TAGS.MOBILE.MEDICATIONS] } })
    .use(AuthPlugin(TokenAudienceEnum.MOBILE))
    .onError(({ error, set }) => { if (error instanceof DomainError) { set.status = error.status; return { error: true, message: error.message, code: error.code }; } })
    .get('/upcoming', async ({ phrase }) => ({ error: false, message: 'تمت مزامنة تذكيرات الدواء بنجاح', data: await medicationDoseService.upcoming((await patientFor(phrase._id))._id) }), { detail: { description: 'يعيد نافذة سبعة أيام ومصفوفة إصدارات حتمية لجدولة Local Notifications. إشعارات الدواء داخل الخادم in-app only ولا تُرسل عبر OneSignal.' }, response: { 200: MedicationReminderSyncResponseSchema, 403: ForbiddenResponseSchema, 404: NotFoundResponseSchema, ...ProtectedApiErrorResponses } });
