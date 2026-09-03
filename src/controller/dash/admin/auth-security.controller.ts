import Elysia, { t } from 'elysia';
import mongoose from 'mongoose';
import { AuthPlugin } from '../../../middleware/auth.middleware';
import authEventService from '../../../services/auth-event.service';
import patientAuthService from '../../../services/patient-auth.service';
import { requireAdminPermission } from '../../../services/admin-auth-permission.service';
import { IAdminPermissionEnum } from '../../../interfaces/admin.interface';
import { AuthEventTypeEnum } from '../../../interfaces/auth-flow.interface';
import { DomainError } from '../../../services/domain-error';
import { SWAGGER_TAGS } from '../../../constants/swagger-tags';
import { BadRequestResponseSchema, ForbiddenResponseSchema, GenericDataResponseSchema, GenericPaginatedResponseSchema, NotFoundResponseSchema, ProtectedApiErrorResponses, ValidationErrorResponseSchema } from '../../../schemas/api-response.schema';
import { resolveClientIp } from '../../../services/client-ip.service';

function handle(error: unknown, set: any) { if (!(error instanceof DomainError)) throw error; set.status = error.status; const retryAfterSeconds=(error as DomainError&{retryAfterSeconds?:number}).retryAfterSeconds;if(retryAfterSeconds)set.headers={...(set.headers??{}),'Retry-After':String(retryAfterSeconds)};return { error: true as const, message: error.message, ...(error.code?{code:error.code}:{}), ...(retryAfterSeconds?{retryAfterSeconds}:{}) }; }
const pagination = (page: number, limit: number, total: number) => { const pages = Math.ceil(total / limit); return { page, limit, total, pages, hasNext: page < pages, hasPrev: page > 1 }; };

export const authSecurityController = new Elysia({ prefix: '/auth-security', detail: { tags: [SWAGGER_TAGS.ADMIN.AUTH_SECURITY] } })
    .use(AuthPlugin())
    .get('/events', async ({ query, phrase, set }) => {
        try {
            await requireAdminPermission(phrase.role, phrase._id, IAdminPermissionEnum.VIEW_AUTH_AUDIT);
            const match: Record<string, unknown> = {};
            if (query.phone) match.phone = { $regex: query.phone, $options: 'i' };
            if (query.flowId) match.flow_id = query.flowId;
            if (query.type) match.type = query.type;
            if (query.success !== undefined) match.success = query.success;
            if (query.userId && mongoose.Types.ObjectId.isValid(query.userId)) match.user_id = new mongoose.Types.ObjectId(query.userId);
            if (query.patientId && mongoose.Types.ObjectId.isValid(query.patientId)) match.patient_id = new mongoose.Types.ObjectId(query.patientId);
            if (query.dateFrom || query.dateTo) { const range: Record<string, Date> = {}; if (query.dateFrom) range.$gte = new Date(query.dateFrom); if (query.dateTo) range.$lte = new Date(query.dateTo); match.createdAt = range; }
            if (query.journey === 'registration') match.type = { $in: [AuthEventTypeEnum.OTP_REQUESTED, AuthEventTypeEnum.OTP_SENT, AuthEventTypeEnum.OTP_VERIFIED, AuthEventTypeEnum.ACCOUNT_CREATED, AuthEventTypeEnum.PIN_CREATED] };
            if (query.journey === 'login') match.type = { $in: [AuthEventTypeEnum.LOGIN_ATTEMPT, AuthEventTypeEnum.LOGIN_SUCCESS, AuthEventTypeEnum.LOGIN_FAILED] };
            const result = await authEventService.list(match, Number(query.page) || 1, Number(query.limit) || 20);
            return { error: false, message: 'تم جلب سجل المصادقة بنجاح', data: result.data, pagination: pagination(result.page, result.limit, result.count) };
        } catch (error) { return handle(error, set); }
    }, { query: t.Object({ page: t.Optional(t.String()), limit: t.Optional(t.String()), phone: t.Optional(t.String()), flowId: t.Optional(t.String()), type: t.Optional(t.Enum(AuthEventTypeEnum)), success: t.Optional(t.Boolean()), journey: t.Optional(t.Union([t.Literal('registration'), t.Literal('login')])), userId: t.Optional(t.String()), patientId: t.Optional(t.String()), dateFrom: t.Optional(t.String()), dateTo: t.Optional(t.String()) }), response: { 200: GenericPaginatedResponseSchema, 403: ForbiddenResponseSchema, 422: ValidationErrorResponseSchema, ...ProtectedApiErrorResponses } })
    .get('/flows/:flowId/timeline', async ({ params, phrase, set }) => {
        try { await requireAdminPermission(phrase.role, phrase._id, IAdminPermissionEnum.VIEW_AUTH_AUDIT); return { error: false, message: 'تم جلب التسلسل الزمني بنجاح', data: await authEventService.timeline(params.flowId) }; }
        catch (error) { return handle(error, set); }
    }, { params: t.Object({ flowId: t.String() }), response: { 200: GenericDataResponseSchema, 403: ForbiddenResponseSchema, ...ProtectedApiErrorResponses } })
    .get('/patients/:patientId/timeline', async ({ params, phrase, set }) => {
        try { await requireAdminPermission(phrase.role, phrase._id, IAdminPermissionEnum.VIEW_AUTH_AUDIT); if (!mongoose.Types.ObjectId.isValid(params.patientId)) throw new DomainError('معرف المريض غير صالح', 400); return { error: false, message: 'تم جلب التسلسل الزمني للمريض بنجاح', data: await authEventService.patientTimeline(new mongoose.Types.ObjectId(params.patientId)) }; }
        catch (error) { return handle(error, set); }
    }, { params: t.Object({ patientId: t.String() }), response: { 200: GenericDataResponseSchema, 400: BadRequestResponseSchema, 403: ForbiddenResponseSchema, ...ProtectedApiErrorResponses } })
    .get('/metrics', async ({ query, phrase, set }) => {
        try { await requireAdminPermission(phrase.role, phrase._id, IAdminPermissionEnum.VIEW_AUTH_AUDIT); const match: Record<string, unknown> = {}; if (query.dateFrom || query.dateTo) { const range: Record<string, Date> = {}; if (query.dateFrom) range.$gte = new Date(query.dateFrom); if (query.dateTo) range.$lte = new Date(query.dateTo); match.createdAt = range; } const rows = await authEventService.metrics(match); const wanted = [AuthEventTypeEnum.OTP_REQUESTED, AuthEventTypeEnum.OTP_SENT, AuthEventTypeEnum.OTP_SEND_FAILED, AuthEventTypeEnum.OTP_VERIFIED, AuthEventTypeEnum.ACCOUNT_CREATED, AuthEventTypeEnum.LOGIN_SUCCESS, AuthEventTypeEnum.LOGIN_FAILED, AuthEventTypeEnum.SUPPORT_OTP_ISSUED]; const data = Object.fromEntries(wanted.map(type => [type, 0])); for (const row of rows as any[]) data[row._id] = row.count; return { error: false, message: 'تم جلب مؤشرات المصادقة بنجاح', data }; }
        catch (error) { return handle(error, set); }
    }, { query: t.Object({ dateFrom: t.Optional(t.String()), dateTo: t.Optional(t.String()) }), response: { 200: GenericDataResponseSchema, 403: ForbiddenResponseSchema, ...ProtectedApiErrorResponses } })
    .post('/flows/:flowId/otp-assistance', async ({ params, body, phrase, request, server, set }) => {
        try { await requireAdminPermission(phrase.role, phrase._id, IAdminPermissionEnum.ISSUE_SUPPORT_OTP); return { error: false, message: 'تم إصدار رمز الدعم؛ سيظهر مرة واحدة فقط', data: await patientAuthService.issueSupportOtp(params.flowId, body.reason, phrase._id, resolveClientIp(request,server)) }; }
        catch (error) { return handle(error, set); }
    }, { params: t.Object({ flowId: t.String() }), body: t.Object({ reason: t.String({ minLength: 5, maxLength: 500 }) }, { additionalProperties: false }), detail: { description: 'يصدر رمز دعم جديداً قصير العمر ويعيده مرة واحدة فقط؛ لا يكشف OTP الرسائل.' }, response: { 200: GenericDataResponseSchema, 400: BadRequestResponseSchema, 403: ForbiddenResponseSchema, 404: NotFoundResponseSchema, 422: ValidationErrorResponseSchema, ...ProtectedApiErrorResponses } })
    .post('/patients/:patientId/reset-pin', async ({ params, body, phrase, request, server, set }) => {
        try { await requireAdminPermission(phrase.role, phrase._id, IAdminPermissionEnum.RESET_PATIENT_PIN); return { error: false, message: 'تم تعيين رمز مؤقت وإلغاء جميع الجلسات؛ سيظهر الرمز مرة واحدة فقط', data: await patientAuthService.adminResetPin(params.patientId, body.reason, phrase._id, resolveClientIp(request,server)) }; }
        catch (error) { return handle(error, set); }
    }, { params: t.Object({ patientId: t.String() }), body: t.Object({ reason: t.String({ minLength: 5, maxLength: 500 }) }, { additionalProperties: false }), response: { 200: GenericDataResponseSchema, 400: BadRequestResponseSchema, 403: ForbiddenResponseSchema, 404: NotFoundResponseSchema, 422: ValidationErrorResponseSchema, ...ProtectedApiErrorResponses } })
    .post('/patients/:patientId/revoke-sessions', async ({ params, body, phrase, request, server, set }) => {
        try { await requireAdminPermission(phrase.role, phrase._id, IAdminPermissionEnum.REVOKE_PATIENT_SESSIONS); return { error: false, message: 'تم إلغاء جلسات المريض بنجاح', data: await patientAuthService.revokePatientSessions(params.patientId, phrase._id, body.reason, resolveClientIp(request,server)) }; }
        catch (error) { return handle(error, set); }
    }, { params: t.Object({ patientId: t.String() }), body: t.Object({ reason: t.Optional(t.String({ maxLength: 500 })) }, { additionalProperties: false }), response: { 200: GenericDataResponseSchema, 400: BadRequestResponseSchema, 403: ForbiddenResponseSchema, 404: NotFoundResponseSchema, 422: ValidationErrorResponseSchema, ...ProtectedApiErrorResponses } })
    .get('/patients/:patientId', async ({ params, phrase, set }) => {
        try { await requireAdminPermission(phrase.role, phrase._id, IAdminPermissionEnum.VIEW_AUTH_AUDIT); return { error: false, message: 'تم جلب معلومات أمان الحساب بنجاح', data: await patientAuthService.securityDetails(params.patientId) }; }
        catch (error) { return handle(error, set); }
    }, { params: t.Object({ patientId: t.String() }), response: { 200: GenericDataResponseSchema, 400: BadRequestResponseSchema, 403: ForbiddenResponseSchema, 404: NotFoundResponseSchema, ...ProtectedApiErrorResponses } });
