import Elysia, { t } from 'elysia';
import patientAuthService from '../../services/patient-auth.service';
import authEventService from '../../services/auth-event.service';
import { DomainError } from '../../services/domain-error';
import { AuthPlugin } from '../../middleware/auth.middleware';
import { IUserRoleEnum } from '../../interfaces/user.interface';
import { SWAGGER_TAGS } from '../../constants/swagger-tags';
import { BadRequestResponseSchema, ConflictResponseSchema, ForbiddenResponseSchema, GenericDataResponseSchema, NotFoundResponseSchema, PublicApiErrorResponses, ProtectedApiErrorResponses, ServiceUnavailableResponseSchema, SuccessResponseWithoutDataSchema, UnauthorizedResponseSchema, ValidationErrorResponseSchema, successResponse } from '../../schemas/api-response.schema';
import { RoleGuardPlugin } from '../../middleware/authorization.middleware';
import sessionService from '../../services/session.service';
import { TokenAudienceEnum } from '../../constants/jwt';
import { resolveClientIp } from '../../services/client-ip.service';

const phoneSchema = t.String({ minLength: 7, maxLength: 30 });
const flowSchema = t.String({ minLength: 20, maxLength: 100 });
const otpSchema = t.String({ pattern: '^\\d{6}$' });
const pinCreateSchema = t.String({ pattern: '^\\d{6}$' });
const deviceFields = { deviceId: t.Optional(t.String({ maxLength: 200 })), deviceName: t.Optional(t.String({ maxLength: 200 })), platform: t.Optional(t.String({ maxLength: 100 })) };
export const authStartBodySchema = t.Object({ phone: phoneSchema }, { additionalProperties: false });
export const otpVerifyBodySchema = t.Object({ flowId: flowSchema, otp: otpSchema }, { additionalProperties: false });
export const pinCreateBodySchema = t.Object({ flowId: flowSchema, pin: pinCreateSchema, ...deviceFields }, { additionalProperties: false });
export const pinLoginBodySchema = t.Object({ flowId: flowSchema, pin: pinCreateSchema, ...deviceFields }, { additionalProperties: false });
export const pinForgotStartBodySchema = t.Object({ phone: phoneSchema }, { additionalProperties: false });
export const pinForgotResendBodySchema = t.Object({ flowId: flowSchema }, { additionalProperties: false });
export const pinForgotVerifyBodySchema = t.Object({ flowId: flowSchema, otp: otpSchema }, { additionalProperties: false });
export const pinForgotResetBodySchema = t.Object({ flowId: flowSchema, pin: pinCreateSchema, confirmPin: pinCreateSchema, ...deviceFields }, { additionalProperties: false });
const debugOtpSchema = t.Optional(t.String({
    pattern: '^\\d{6}$',
    description: 'Development/testing only. Returned only when NODE_ENV is not production and OTP_DEBUG_RETURN_CODE=true; never returned in production.',
}));
export const authStartDataSchema = t.Union([
    t.Object({ flowId: flowSchema, nextStep: t.Literal('PIN') }, { additionalProperties: false }),
    t.Object({ flowId: flowSchema, nextStep: t.Literal('OTP'), expiresAt: t.String({ format: 'date-time' }), debugOtp: debugOtpSchema }, { additionalProperties: false }),
]);
export const otpResendDataSchema = t.Object({
    flowId: flowSchema,
    nextStep: t.Literal('OTP'),
    expiresAt: t.String({ format: 'date-time' }),
    debugOtp: debugOtpSchema,
}, { additionalProperties: false });
const AuthStartResponseSchema = successResponse(authStartDataSchema);
const OtpResendResponseSchema = successResponse(otpResendDataSchema);
const errors = { 400: BadRequestResponseSchema, 401: UnauthorizedResponseSchema, 404: NotFoundResponseSchema, 409: ConflictResponseSchema, 422: ValidationErrorResponseSchema, 503: ServiceUnavailableResponseSchema, ...PublicApiErrorResponses };
function fail(error: unknown, set: any) {
    if (!(error instanceof DomainError)) throw error;
    set.status = error.status; const retryAfterSeconds=(error as DomainError&{retryAfterSeconds?:number}).retryAfterSeconds;
    if(retryAfterSeconds){set.headers={...(set.headers??{}),'Retry-After':String(retryAfterSeconds)}}
    return { error: true as const, message: error.message, ...(error.code?{code:error.code}:{}), ...(retryAfterSeconds?{retryAfterSeconds}:{}) };
}

export const mobileAuthController = new Elysia({ prefix: '/auth', detail: { tags: [SWAGGER_TAGS.MOBILE.AUTH] } })
    .post('/start', async ({ body, request, server, set }) => {
        try { return { error: false, message: 'تم بدء المصادقة بنجاح', data: await patientAuthService.start(body.phone, { ip: resolveClientIp(request,server) }) }; }
        catch (error) { return fail(error, set); }
    }, { body: authStartBodySchema, detail: { description: 'نقطة البداية الموحدة: تعيد PIN للحساب الموجود أو OTP للرقم الجديد دون كشف accountExists. debugOtp اختياري للتطوير/الاختبار فقط ولا يظهر في production.' }, response: { 200: AuthStartResponseSchema, ...errors } })
    .post('/otp/resend', async ({ body, request, server, set }) => {
        try { return { error: false, message: 'تم إرسال رمز تحقق جديد', data: await patientAuthService.resend(body.flowId, resolveClientIp(request,server)) }; }
        catch (error) { return fail(error, set); }
    }, { body: t.Object({ flowId: flowSchema }, { additionalProperties: false }), detail: { description: 'يولد OTP جديداً. debugOtp اختياري للتطوير/الاختبار فقط ولا يظهر في production.' }, response: { 200: OtpResendResponseSchema, ...errors } })
    .post('/otp/verify', async ({ body, request, server, set }) => {
        try { return { error: false, message: 'تم التحقق من رقم الهاتف', data: await patientAuthService.verifyOtp(body.flowId, body.otp, resolveClientIp(request,server)) }; }
        catch (error) { return fail(error, set); }
    }, { body: otpVerifyBodySchema, response: { 200: GenericDataResponseSchema, ...errors } })
    .post('/pin/forgot/start', async ({ body, request, server, set }) => {
        try { return { error: false, message: 'تم بدء استعادة الرمز السري', data: await patientAuthService.startPinRecovery(body.phone, { ip: resolveClientIp(request, server) }) }; }
        catch (error) { return fail(error, set); }
    }, { body: pinForgotStartBodySchema, detail: { description: 'يبدأ تدفق استعادة PIN لمريض نشط فقط. يرسل OTP من 6 أرقام؛ debugOtp للتطوير فقط ولا يظهر في production.' }, response: { 200: OtpResendResponseSchema, ...errors } })
    .post('/pin/forgot/resend', async ({ body, request, server, set }) => {
        try { return { error: false, message: 'تم إرسال رمز تحقق جديد لاستعادة الرمز السري', data: await patientAuthService.resendPinRecovery(body.flowId, resolveClientIp(request, server)) }; }
        catch (error) { return fail(error, set); }
    }, { body: pinForgotResendBodySchema, detail: { description: 'يعيد إرسال OTP الاستعادة بعد 45 ثانية، وبحد أقصى 3 مرات. الرد المحدود يتضمن Retry-After وretryAfterSeconds.' }, response: { 200: OtpResendResponseSchema, ...errors } })
    .post('/pin/forgot/verify', async ({ body, request, server, set }) => {
        try { return { error: false, message: 'تم التحقق من رمز استعادة الرمز السري', data: await patientAuthService.verifyPinRecoveryOtp(body.flowId, body.otp, resolveClientIp(request, server)) }; }
        catch (error) { return fail(error, set); }
    }, { body: pinForgotVerifyBodySchema, detail: { description: 'يتحقق من OTP الاستعادة لمرة واحدة فقط ولا ينشئ جلسة قبل اختيار PIN جديد.' }, response: { 200: GenericDataResponseSchema, ...errors } })
    .post('/pin/forgot/reset', async ({ body, request, server, set }) => {
        try { return { error: false, message: 'تمت استعادة الرمز السري وتسجيل الدخول بنجاح', data: await patientAuthService.resetRecoveredPin(body.flowId, body.pin, body.confirmPin, { deviceId: body.deviceId, deviceName: body.deviceName, platform: body.platform }, resolveClientIp(request, server)) }; }
        catch (error) { return fail(error, set); }
    }, { body: pinForgotResetBodySchema, detail: { description: 'يتطلب OTP استعادة تم التحقق منه وPIN من 6 أرقام متطابقة. يلغي كل الجلسات السابقة ثم يصدر جلسة مريض جديدة غير مقيّدة.' }, response: { 200: GenericDataResponseSchema, ...errors } })
    .post('/pin/create', async ({ body, request, server, set }) => {
        try { set.status = 201; return { error: false, message: 'تم إنشاء الحساب وتسجيل الدخول بنجاح', data: await patientAuthService.createPin(body.flowId, body.pin, { deviceId: body.deviceId, deviceName: body.deviceName, platform: body.platform }, resolveClientIp(request,server)) }; }
        catch (error) { return fail(error, set); }
    }, { body: pinCreateBodySchema, detail: { description: 'ينشئ PIN من 6 أرقام بعد OTP، ثم ينشئ الحساب والجلسة تلقائياً. لا يتطلب اسماً أو DOB أو كلمة مرور.' }, response: { 201: GenericDataResponseSchema, ...errors } })
    .post('/pin/login', async ({ body, request, server, set }) => {
        try { return { error: false, message: 'تم تسجيل الدخول بنجاح', data: await patientAuthService.login(body.flowId, body.pin, { deviceId: body.deviceId, deviceName: body.deviceName, platform: body.platform }, resolveClientIp(request,server)) }; }
        catch (error) { return fail(error, set); }
    }, { body: pinLoginBodySchema, detail: { description: 'يسجل دخول المريض برمز PIN مكون من 6 أرقام.' }, response: { 200: GenericDataResponseSchema, ...errors } })
    .post('/refresh', async ({ body, request, server, set }) => {
        try { return { error: false, message: 'تم تحديث الجلسة بنجاح', data: await sessionService.refresh(body.refreshToken, TokenAudienceEnum.MOBILE, { ip: resolveClientIp(request,server) }) }; }
        catch (error) { return fail(error, set); }
    }, { body: t.Object({ refreshToken: t.String({ minLength: 1 }) }, { additionalProperties: false }), response: { 200: GenericDataResponseSchema, ...errors } })
    .group('', (app) => app.use(AuthPlugin(TokenAudienceEnum.MOBILE)).use(RoleGuardPlugin([IUserRoleEnum.PATIENT]))
        .post('/pin/change-required', async ({ body, phrase, set }) => {
            if (phrase.role !== IUserRoleEnum.PATIENT) { set.status = 403; return { error: true, message: 'غير مصرح لك بالوصول' }; }
            try { return { error: false, message: 'تم تغيير الرمز السري بنجاح', data: await patientAuthService.changeRequiredPin(phrase._id, phrase.sid, body.pin) }; }
            catch (error) { return fail(error, set); }
        }, { body: t.Object({ pin: pinCreateSchema }, { additionalProperties: false }), response: { 200: GenericDataResponseSchema, 400: BadRequestResponseSchema, 403: ForbiddenResponseSchema, 409: ConflictResponseSchema, 422: ValidationErrorResponseSchema, ...ProtectedApiErrorResponses } })
        .get('/sessions', async ({ phrase }) => {
            const sessions = await sessionService.list(phrase._id);
            return { error: false, message: 'تم جلب الجلسات بنجاح', data: sessions.map(session => ({ ...session, current: session.sid === phrase.sid })) };
        }, { response: { 200: GenericDataResponseSchema, 503: ServiceUnavailableResponseSchema, ...ProtectedApiErrorResponses } })
        .post('/logout', async ({ phrase }) => {
            await sessionService.revoke(phrase._id, phrase.sid, { reasonCode: 'USER_LOGOUT' });
            return { error: false, message: 'تم تسجيل الخروج بنجاح' };
        }, { response: { 200: SuccessResponseWithoutDataSchema, 503: ServiceUnavailableResponseSchema, ...ProtectedApiErrorResponses } })
        .post('/logout-all', async ({ phrase }) => {
            await sessionService.revokeAll(phrase._id, { reasonCode: 'USER_LOGOUT_ALL' });
            return { error: false, message: 'تم تسجيل الخروج من جميع الأجهزة بنجاح' };
        }, { response: { 200: SuccessResponseWithoutDataSchema, 503: ServiceUnavailableResponseSchema, ...ProtectedApiErrorResponses } })
    );
