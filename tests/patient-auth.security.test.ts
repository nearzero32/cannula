import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { Value } from '@sinclair/typebox/value';
import AuthFlow from '../src/models/auth-flow.model';
import AuthEvent from '../src/models/auth-event.model';
import ActivityLog from '../src/models/activity-log.model';
import User from '../src/models/users.model';
import Patient from '../src/models/patients.model';
import Admin from '../src/models/admins.model';
import patientAuthService, { normalizePhone, PIN_PATTERN } from '../src/services/patient-auth.service';
import authEventService from '../src/services/auth-event.service';
import otpDeliveryService from '../src/services/otp-delivery.service';
import { sanitizeCredentialData } from '../src/services/credential-sanitizer';
import { AuthFlowStepEnum as S } from '../src/interfaces/auth-flow.interface';
import { IAdminPermissionEnum } from '../src/interfaces/admin.interface';
import { requireAdminPermission } from '../src/services/admin-auth-permission.service';
import { verifyPassword } from '../src/constants/hashing';
import { hashPassword } from '../src/constants/hashing';
import userService from '../src/services/user.service';
import patientService from '../src/services/patient.service';
import Elysia from 'elysia';
import { AuthPlugin } from '../src/middleware/auth.middleware';
import { signAccessToken, TokenAudienceEnum } from '../src/constants/jwt';
import sessionService from '../src/services/session.service';
import { authStartBodySchema, authStartDataSchema, otpResendDataSchema, otpVerifyBodySchema, pinCreateBodySchema, pinLoginBodySchema } from '../src/controller/mobile/auth.controller';
import { assertOtpDebugConfiguration, isOtpDebugReturnEnabled } from '../src/config/otp-debug.config';
import ActivityLogService from '../src/services/activity-log.service';
import securityRateLimitService from '../src/services/security-rate-limit.service';
import { DomainError } from '../src/services/domain-error';

const query = <T>(value: T) => ({ select() { return this; }, sort() { return this; }, lean() { return this; }, exec: async () => value });
const objectId = new mongoose.Types.ObjectId();
const originalNodeEnv = process.env.NODE_ENV;
const originalOtpDebug = process.env.OTP_DEBUG_RETURN_CODE;

beforeEach(() => {
    process.env.ACCESS_TOKEN_SECRET = 'test-access-secret-that-is-long-enough';
    process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret-that-is-long-enough';
    process.env.OTP_HASH_SECRET = 'test-otp-hash-secret-that-is-long-enough';
    process.env.NODE_ENV = 'test';
    process.env.OTP_DEBUG_RETURN_CODE = 'false';
    spyOn(securityRateLimitService,'enforce').mockResolvedValue({allowed:true,remaining:10,retryAfterSeconds:60});
    spyOn(securityRateLimitService,'check').mockResolvedValue({allowed:true,remaining:10,retryAfterSeconds:0});
    spyOn(securityRateLimitService,'reset').mockResolvedValue();
});
afterEach(() => {
    mock.restore();
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalNodeEnv;
    if (originalOtpDebug === undefined) delete process.env.OTP_DEBUG_RETURN_CODE; else process.env.OTP_DEBUG_RETURN_CODE = originalOtpDebug;
});

function arrangeNewPhoneStart() {
    spyOn(AuthFlow, 'countDocuments').mockReturnValue(query(0) as never);
    spyOn(User, 'findOne').mockReturnValue(query(null) as never);
    spyOn(AuthFlow, 'create').mockResolvedValue({ _id: objectId, flow_id: 'flow', phone: '07700000000', resend_count: 0, step: S.OTP } as never);
    const update = spyOn(AuthFlow, 'findOneAndUpdate').mockReturnValue(query({ _id: objectId, flow_id: 'flow', phone: '07700000000', resend_count: 0, step: S.OTP }) as never);
    const event = spyOn(authEventService, 'record').mockResolvedValue({} as never);
    let delivered = '';
    spyOn(otpDeliveryService, 'send').mockImplementation(async (_phone, otp) => { delivered = otp; });
    return { update, event, delivered: () => delivered };
}

describe('Patient authentication contracts and security', () => {
    test('registration starts with phone only and PIN creation requires no profile/password fields', () => {
        expect(Value.Check(authStartBodySchema, { phone: '07700000000' })).toBe(true);
        expect(Value.Check(authStartBodySchema, { phone: '07700000000', password: 'secret' })).toBe(false);
        expect(Value.Check(pinCreateBodySchema, { flowId: '12345678-1234-1234-1234-123456789012', pin: '123456' })).toBe(true);
        expect(Value.Check(pinCreateBodySchema, { flowId: '12345678-1234-1234-1234-123456789012', pin: '12345' })).toBe(false);
        expect(Value.Check(pinCreateBodySchema, { flowId: '12345678-1234-1234-1234-123456789012', pin: '1234567' })).toBe(false);
        expect(Value.Check(pinCreateBodySchema, { flowId: '12345678-1234-1234-1234-123456789012', pin: '12345a' })).toBe(false);
        for (const field of ['full_name', 'date_of_birth', 'password']) expect(Value.Check(pinCreateBodySchema, { flowId: '12345678-1234-1234-1234-123456789012', pin: '123456', [field]: 'x' })).toBe(false);
        expect(PIN_PATTERN.test('123456')).toBe(true); expect(PIN_PATTERN.test('12345a')).toBe(false);
    });

    test('normalizes supported phone punctuation and rejects malformed numbers', () => {
        expect(normalizePhone(' 0770 123-4567 ')).toBe('07701234567');
        expect(() => normalizePhone('not-a-phone')).toThrow('غير صالح');
    });

    test('existing patient phone returns PIN without sending OTP', async () => {
        spyOn(AuthFlow, 'countDocuments').mockReturnValue(query(0) as never);
        spyOn(User, 'findOne').mockReturnValue(query({ _id: objectId }) as never);
        spyOn(AuthFlow, 'create').mockResolvedValue({ _id: objectId, flow_id: 'flow', phone: '07700000000', resend_count: 0, step: S.PIN } as never);
        spyOn(authEventService, 'record').mockResolvedValue({} as never);
        const send = spyOn(otpDeliveryService, 'send').mockResolvedValue();
        const result = await patientAuthService.start('07700000000');
        expect(result.nextStep).toBe(S.PIN); expect(result.flowId).toMatch(/^[0-9a-f-]{36}$/);
        expect(send).not.toHaveBeenCalled();
    });

    test('new phone creates an OTP challenge without returning OTP plaintext', async () => {
        const { update, event, delivered } = arrangeNewPhoneStart();
        const result = await patientAuthService.start('07700000000');
        expect(result.nextStep).toBe(S.OTP); expect(result.flowId).toMatch(/^[0-9a-f-]{36}$/);
        if (result.nextStep !== S.OTP) throw new Error('Expected OTP step');
        expect(result.expiresAt).toBeString(); expect(result).not.toHaveProperty('debugOtp');
        expect(delivered()).toMatch(/^\d{6}$/);
        const mutation = (update.mock.calls[0] as any)[1];
        expect(mutation.$set.otp_hash).not.toBe(delivered());
        expect(JSON.stringify(mutation)).not.toContain(delivered());
        expect(JSON.stringify(event.mock.calls)).not.toContain(delivered());
    });

    test('development with OTP debug enabled returns the immediate code', async () => {
        process.env.NODE_ENV = 'development'; process.env.OTP_DEBUG_RETURN_CODE = 'true';
        const { delivered } = arrangeNewPhoneStart();
        const result = await patientAuthService.start('07700000000');
        if (result.nextStep !== S.OTP) throw new Error('Expected OTP step');
        expect(result.debugOtp).toBe(delivered());
        expect(result.debugOtp).toMatch(/^\d{6}$/);
        expect(Value.Check(authStartDataSchema, result)).toBe(true);
    });

    test('test environment with OTP debug enabled returns a code that verifies normally', async () => {
        process.env.NODE_ENV = 'test'; process.env.OTP_DEBUG_RETURN_CODE = 'true';
        const { update, event } = arrangeNewPhoneStart();
        const result = await patientAuthService.start('07700000000');
        if (result.nextStep !== S.OTP) throw new Error('Expected OTP step');
        const mutation = (update.mock.calls[0] as any)[1];
        const verificationFlow = { _id: objectId, flow_id: result.flowId, phone: '07700000000', step: S.OTP, expires_at: new Date(Date.now() + 60_000), otp_hash: mutation.$set.otp_hash, otp_expires_at: mutation.$set.otp_expires_at, otp_attempts: 0 };
        spyOn(AuthFlow, 'findOne').mockReturnValue(query(verificationFlow) as never);
        spyOn(AuthFlow, 'findOneAndUpdate').mockReturnValue(query({ ...verificationFlow, step: S.CREATE_PIN }) as never);
        expect(result.debugOtp).toMatch(/^\d{6}$/);
        await expect(patientAuthService.verifyOtp(result.flowId, result.debugOtp!)).resolves.toEqual({ nextStep: S.CREATE_PIN });
        expect(JSON.stringify(event.mock.calls)).not.toContain(result.debugOtp!);
    });

    test('production never returns debugOtp and rejects an enabled debug configuration', async () => {
        process.env.NODE_ENV = 'production'; process.env.OTP_DEBUG_RETURN_CODE = 'true';
        const { delivered } = arrangeNewPhoneStart();
        const result = await patientAuthService.start('07700000000');
        expect(result).not.toHaveProperty('debugOtp');
        expect(JSON.stringify(result)).not.toContain(delivered());
        expect(() => assertOtpDebugConfiguration()).toThrow('forbidden');
        expect(isOtpDebugReturnEnabled()).toBe(false);
    });

    test('OTP debug configuration is enabled only by the exact flag outside production', () => {
        expect(isOtpDebugReturnEnabled({ NODE_ENV: 'development', OTP_DEBUG_RETURN_CODE: 'true' })).toBe(true);
        expect(isOtpDebugReturnEnabled({ NODE_ENV: 'test', OTP_DEBUG_RETURN_CODE: 'true' })).toBe(true);
        expect(isOtpDebugReturnEnabled({ NODE_ENV: 'development', OTP_DEBUG_RETURN_CODE: 'false' })).toBe(false);
        expect(isOtpDebugReturnEnabled({ NODE_ENV: 'development', OTP_DEBUG_RETURN_CODE: 'TRUE' })).toBe(false);
        expect(() => assertOtpDebugConfiguration({ NODE_ENV: 'production', OTP_DEBUG_RETURN_CODE: 'true' })).toThrow('OTP_DEBUG_RETURN_CODE=true');
    });

    test('existing patient PIN step never returns debugOtp', async () => {
        process.env.NODE_ENV = 'development'; process.env.OTP_DEBUG_RETURN_CODE = 'true';
        spyOn(AuthFlow, 'countDocuments').mockReturnValue(query(0) as never);
        spyOn(User, 'findOne').mockReturnValue(query({ _id: objectId }) as never);
        spyOn(AuthFlow, 'create').mockResolvedValue({ _id: objectId, flow_id: 'flow', phone: '07700000000', resend_count: 0, step: S.PIN } as never);
        spyOn(authEventService, 'record').mockResolvedValue({} as never);
        const send = spyOn(otpDeliveryService, 'send').mockResolvedValue();
        const result = await patientAuthService.start('07700000000');
        expect(result.nextStep).toBe(S.PIN); expect(result).not.toHaveProperty('debugOtp'); expect(send).not.toHaveBeenCalled();
        expect(Value.Check(authStartDataSchema, result)).toBe(true);
    });

    test('OTP resend returns only the newly generated debug code and overwrites the stored hash', async () => {
        process.env.NODE_ENV = 'development'; process.env.OTP_DEBUG_RETURN_CODE = 'true';
        spyOn(crypto, 'randomInt').mockReturnValue(739204 as never);
        const oldHash = crypto.createHmac('sha256', process.env.OTP_HASH_SECRET || process.env.ACCESS_TOKEN_SECRET!).update('111111').digest('hex');
        const flow = { _id: objectId, flow_id: 'flow-id-12345678901234567890', phone: '07700000000', step: S.OTP, expires_at: new Date(Date.now() + 60_000), resend_count: 0, otp_hash: oldHash };
        spyOn(AuthFlow, 'findOne').mockReturnValue(query(flow) as never);
        const update = spyOn(AuthFlow, 'findOneAndUpdate').mockReturnValue(query({ ...flow, otp_hash: 'new' }) as never);
        spyOn(authEventService, 'record').mockResolvedValue({} as never);
        spyOn(otpDeliveryService, 'send').mockResolvedValue();
        const result = await patientAuthService.resend(flow.flow_id);
        expect(result.debugOtp).toBe('739204'); expect(result.expiresAt).toBeString();
        expect(Value.Check(otpResendDataSchema, result)).toBe(true);
        const mutation = (update.mock.calls[0] as any)[1];
        expect(mutation.$set.otp_hash).not.toBe(oldHash);
        expect(JSON.stringify(mutation)).not.toContain(result.debugOtp!);
    });

    test('correct OTP verifies once and clears every challenge hash', async () => {
        const otp = '123456';
        const hash = crypto.createHmac('sha256', process.env.OTP_HASH_SECRET || process.env.ACCESS_TOKEN_SECRET!).update(otp).digest('hex');
        const flow = { _id: objectId, flow_id: 'flow', phone: '07700000000', step: S.OTP, expires_at: new Date(Date.now() + 60_000), otp_hash: hash, otp_expires_at: new Date(Date.now() + 60_000), otp_attempts: 0 };
        spyOn(AuthFlow, 'findOne').mockReturnValue(query(flow) as never);
        const consume = spyOn(AuthFlow, 'findOneAndUpdate').mockReturnValue(query({ ...flow, step: S.CREATE_PIN }) as never);
        spyOn(authEventService, 'record').mockResolvedValue({} as never);
        expect(await patientAuthService.verifyOtp('flow', otp)).toEqual({ nextStep: S.CREATE_PIN });
        expect((consume.mock.calls[0] as any)[1].$unset).toEqual(expect.objectContaining({ otp_hash: 1, support_otp_hash: 1 }));
        consume.mockReturnValue(query(null) as never);
        const replayError = await patientAuthService.verifyOtp('flow', otp).then(() => null, error => error);
        expect(replayError).toBeInstanceOf(Error);
        expect(replayError.message).toContain('مسبقاً');
    });

    test('wrong, expired, and attempt-limited OTPs are rejected', async () => {
        const flow = { _id: objectId, flow_id: 'flow', phone: '07700000000', step: S.OTP, expires_at: new Date(Date.now() + 60_000), otp_hash: 'wrong', otp_expires_at: new Date(Date.now() + 60_000), otp_attempts: 0 };
        const find = spyOn(AuthFlow, 'findOne').mockReturnValue(query(flow) as never);
        const atomic=spyOn(AuthFlow, 'findOneAndUpdate').mockReturnValueOnce(query(null) as never).mockReturnValueOnce(query({...flow,otp_attempts:1}) as never); spyOn(authEventService, 'record').mockResolvedValue({} as never);
        await expect(patientAuthService.verifyOtp('flow', '123456')).rejects.toThrow('غير صحيح');
        find.mockReturnValue(query({ ...flow, otp_expires_at: new Date(Date.now() - 1) }) as never);
        atomic.mockReturnValue(query(null) as never);
        await expect(patientAuthService.verifyOtp('flow', '123456')).rejects.toThrow('صلاحية');
        find.mockReturnValue(query({ ...flow, otp_attempts: 5 }) as never);
        await expect(patientAuthService.verifyOtp('flow', '123456')).rejects.toThrow('محاولات');
    });

    test('OTP resend and PIN creation enforce state and limits', async () => {
        await expect(patientAuthService.createPin('flow', '12345')).rejects.toThrow('6 أرقام');
        await expect(patientAuthService.createPin('flow', '1234567')).rejects.toThrow('6 أرقام');
        await expect(patientAuthService.createPin('flow', '12345a')).rejects.toThrow('6 أرقام');
        spyOn(AuthFlow, 'findOne').mockReturnValue(query({ _id: objectId, flow_id: 'flow', phone: '07700000000', step: S.OTP, expires_at: new Date(Date.now() + 60_000), resend_count: 3 }) as never);
        spyOn(AuthFlow, 'findOneAndUpdate').mockReturnValue(query(null) as never);
        spyOn(authEventService, 'record').mockResolvedValue({} as never);
        await expect(patientAuthService.resend('flow')).rejects.toThrow('إعادة الإرسال');
        spyOn(AuthFlow, 'findOneAndUpdate').mockReturnValue(query(null) as never);
        await expect(patientAuthService.createPin('flow', '123456')).rejects.toThrow('غير صالح أو مستخدم');
    });

    test('PIN login accepts exactly six numeric digits', () => {
        const flowId = '12345678-1234-1234-1234-123456789012';
        expect(Value.Check(pinLoginBodySchema, { flowId, pin: '123456' })).toBe(true);
        expect(Value.Check(pinLoginBodySchema, { flowId, pin: '12345' })).toBe(false);
        expect(Value.Check(pinLoginBodySchema, { flowId, pin: '1234567' })).toBe(false);
        expect(Value.Check(pinLoginBodySchema, { flowId, pin: '12345a' })).toBe(false);
        expect(Value.Check(otpVerifyBodySchema, { flowId, otp: '123456' })).toBe(true);
        expect(Value.Check(otpVerifyBodySchema, { flowId, otp: '12345a' })).toBe(false);
    });

    test('verified OTP flow creates exactly one account and authenticated session', async () => {
        const flow = { _id: objectId, flow_id: 'flow', phone: '07700000000', step: S.CREATE_PIN, otp_verified_at: new Date(), expires_at: new Date(Date.now() + 60_000) };
        const claim = spyOn(AuthFlow, 'findOneAndUpdate').mockReturnValueOnce(query(flow) as never).mockReturnValueOnce(query(null) as never);
        const userId = new mongoose.Types.ObjectId(), patientId = new mongoose.Types.ObjectId();
        const createUser = spyOn(userService, 'create').mockResolvedValue({ _id: userId, phone: flow.phone, role: 'patient', status: 'active' } as never);
        spyOn(patientService, 'create').mockResolvedValue({ _id: patientId } as never);
        spyOn(AuthFlow, 'updateOne').mockReturnValue(query({}) as never); spyOn(authEventService, 'record').mockResolvedValue({} as never);
        spyOn(sessionService, 'create').mockResolvedValue({ accessToken: 'access-token', refreshToken: 'refresh-token', mustChangePin: false, sessionId: '12345678-1234-4234-8234-123456789012' });
        const result = await patientAuthService.createPin('flow', '123456');
        expect(result.accessToken).toBeString(); expect(result.refreshToken).toBeString();
        const payload = (createUser.mock.calls[0] as any)[0];
        expect(payload.full_name).toBe(flow.phone); expect(payload).not.toHaveProperty('password_show'); expect(payload.is_phone_verified).toBe(true);
        expect(payload.password_hash).toStartWith('$argon2id$');
        expect(await verifyPassword('123456', payload.password_hash)).toBe(true);
        await expect(patientAuthService.createPin('flow', '123456')).rejects.toThrow('مستخدم');
        expect(createUser).toHaveBeenCalledTimes(1); expect((claim.mock.calls[0] as any)[0]).toEqual(expect.objectContaining({ consumed_at: null, otp_verified_at: { $ne: null } }));
    });

    test('correct six-digit PIN logs in, wrong six-digit PIN fails, and phone-wide failures rate limit', async () => {
        const pin = '123456', hash = await hashPassword(pin);
        const flow = { _id: objectId, flow_id: 'flow', phone: '07700000000', step: S.PIN, expires_at: new Date(Date.now() + 60_000), login_attempts: 0, user_id: objectId };
        spyOn(AuthFlow, 'findOne').mockReturnValue(query(flow) as never);
        const save = mock(async () => {});
        const findUser = spyOn(User, 'findOne').mockReturnValue(query({ _id: objectId, phone: flow.phone, role: 'patient', status: 'active', password_hash: hash, must_change_pin: false, save }) as never);
        spyOn(Patient, 'findOne').mockReturnValue(query({ _id: new mongoose.Types.ObjectId() }) as never);
        spyOn(AuthFlow, 'updateOne').mockReturnValue(query({}) as never); spyOn(authEventService, 'record').mockResolvedValue({} as never);
        spyOn(sessionService, 'create').mockResolvedValue({ accessToken: 'access-token', refreshToken: 'refresh-token', mustChangePin: false, sessionId: '12345678-1234-4234-8234-123456789012' });
        expect((await patientAuthService.login('flow', pin)).accessToken).toBeString();
        findUser.mockReturnValue(query({ _id: objectId, phone: flow.phone, role: 'patient', status: 'active', password_hash: hash, save }) as never);
        await expect(patientAuthService.login('flow', '654321')).rejects.toThrow('غير صحيح');
        await expect(patientAuthService.login('flow', 'password')).rejects.toThrow('6 أرقام');
        (securityRateLimitService.check as any).mockRejectedValueOnce(new DomainError('تم تجاوز محاولات تسجيل الدخول',429,'AUTH_PIN_RATE_LIMITED'));
        await expect(patientAuthService.login('flow', pin)).rejects.toThrow('محاولات');
    });

    test('generic audit sanitizer recursively redacts every credential family', () => {
        const sanitized = sanitizeCredentialData({ password: 'p', nested: { password_show: 'legacy', password_hash: 'hash', pin: '1', temporaryPin: '2', otp: '3', debugOtp: '8', supportOtp: '4', accessToken: '5', refreshToken: '6', authorization: '7', safe: 'ok' } });
        const serialized = JSON.stringify(sanitized);
        for (const secret of ['"p"', '"1"', '"2"', '"3"', '"4"', '"5"', '"6"', '"7"', '"8"']) expect(serialized).not.toContain(secret);
        expect((sanitized as any).nested.safe).toBe('ok');
    });

    test('flow and audit persistence hide hashes and define intended indexes', () => {
        expect((AuthFlow.schema.path('otp_hash') as any).options.select).toBe(false);
        expect((AuthFlow.schema.path('support_otp_hash') as any).options.select).toBe(false);
        expect(AuthFlow.schema.indexes().some(([fields, options]) => fields.expires_at === 1 && options.expireAfterSeconds === 0)).toBe(true);
        expect(AuthEvent.schema.indexes().some(([fields]) => fields.flow_id === 1 && fields.createdAt === 1)).toBe(true);
        expect(User.schema.path('must_change_pin')).toBeDefined();
        expect(User.schema.path('password_show')).toBeUndefined();
        expect((User.schema.path('password_hash') as any).options).toMatchObject({ required: true, select: false });
        expect(User.schema.indexes().some(([fields, options]) => fields.phone === 1 && options.unique === true)).toBe(true);
    });

    test('AuthEvent sanitizes credential metadata before persistence', async () => {
        const create = spyOn(AuthEvent, 'create').mockResolvedValue({} as never);
        await authEventService.record({ type: 'LOGIN_FAILED', success: false, metadata: { pin: '123456', debugOtp: '483921', accessToken: 'token', safe: 'ok' } });
        const metadata = (create.mock.calls[0] as any)[0].metadata;
        expect(metadata).toEqual({ pin: '[REDACTED]', debugOtp: '[REDACTED]', accessToken: '[REDACTED]', safe: 'ok' });
    });

    test('ActivityLog sanitizer never persists debugOtp plaintext', async () => {
        const create = spyOn(ActivityLog, 'create').mockResolvedValue({} as never);
        await ActivityLogService.create({ request_body: { debugOtp: '483921', safe: 'ok' } } as never);
        const persisted = (create.mock.calls[0] as any)[0];
        expect(persisted.request_body).toEqual({ debugOtp: '[REDACTED]', safe: 'ok' });
        expect(JSON.stringify(persisted)).not.toContain('483921');
    });

    test('support OTP requires a recent OTP flow, expires quickly, and is audited without plaintext', async () => {
        const update = spyOn(AuthFlow, 'findOneAndUpdate').mockReturnValue(query({ phone: '07700000000', support_otp_expires_at: new Date(Date.now() + 180_000) }) as never);
        const event = spyOn(authEventService, 'record').mockResolvedValue({} as never);
        const result = await patientAuthService.issueSupportOtp('flow', 'SMS not received', objectId.toString());
        expect(result.supportOtp).toMatch(/^\d{6}$/);
        expect(result.expiresAt!.getTime() - Date.now()).toBeLessThanOrEqual(180_000);
        const mutation = (update.mock.calls[0] as any)[1];
        expect(mutation.$set.support_otp_hash).not.toBe(result.supportOtp);
        expect(JSON.stringify((event.mock.calls[0] as any)[0])).not.toContain(result.supportOtp);
        update.mockReturnValue(query(null) as never);
        await expect(patientAuthService.issueSupportOtp('flow', 'again', objectId.toString())).rejects.toThrow('لا يمكن');
    });

    test('admin PIN reset hashes the one-time PIN, forces change, revokes sessions, and audits safely', async () => {
        const patientId = new mongoose.Types.ObjectId(), userId = new mongoose.Types.ObjectId();
        spyOn(Patient, 'findById').mockReturnValue(query({ _id: patientId, user_id: userId }) as never);
        spyOn(User, 'findOne').mockReturnValue(query({ _id: userId, phone: '07700000000', role: 'patient' }) as never);
        const update = spyOn(User, 'findOneAndUpdate').mockReturnValue(query({ _id: userId, phone: '07700000000' }) as never);
        spyOn(sessionService, 'revokeAll').mockResolvedValue(1);
        const event = spyOn(authEventService, 'record').mockResolvedValue({} as never);
        const result = await patientAuthService.adminResetPin(patientId.toString(), 'Forgot PIN', objectId.toString());
        expect(result.temporaryPin).toMatch(/^\d{6}$/); expect(result.mustChangePin).toBe(true);
        const fields = (update.mock.calls[0] as any)[1].$set;
        expect(fields.password_hash).toStartWith('$argon2id$');
        expect(fields.password_hash).not.toBe(result.temporaryPin); expect(await verifyPassword(result.temporaryPin, fields.password_hash)).toBe(true);
        expect(fields).not.toHaveProperty('password_show'); expect(fields.must_change_pin).toBe(true);
        expect(JSON.stringify(event.mock.calls)).not.toContain(result.temporaryPin);
    });

    test('forced PIN change replaces temporary credential, clears restriction, and returns rotated tokens', async () => {
        const oldHash = await hashPassword('111111');
        const user = { _id: objectId, phone: '07700000000', role: 'patient', status: 'active', password_hash: oldHash, must_change_pin: true, save: mock(async () => {}) };
        spyOn(User, 'findOne').mockReturnValue(query(user) as never);
        const restrictedSid = '12345678-1234-4234-8234-123456789012';
        spyOn(sessionService, 'get').mockResolvedValue({ sid: restrictedSid, userId: objectId.toString(), role: 'patient', audience: TokenAudienceEnum.MOBILE, restricted: true, currentRefreshDigest: 'hash', createdAt: '', lastSeenAt: '', lastRefreshedAt: '', expiresAt: '', deviceName: 'Pixel' });
        spyOn(sessionService, 'revokeAll').mockResolvedValue(1);
        spyOn(sessionService, 'create').mockResolvedValue({ accessToken: 'new-access', refreshToken: 'new-refresh', mustChangePin: false, sessionId: '87654321-4321-4321-8321-210987654321' });
        spyOn(authEventService, 'record').mockResolvedValue({} as never);
        const result = await patientAuthService.changeRequiredPin(objectId.toString(), restrictedSid, '222222');
        expect(result.mustChangePin).toBe(false); expect(user.must_change_pin).toBe(false);
        expect(result.sessionId).not.toBe(restrictedSid);
        expect(await verifyPassword('222222', user.password_hash)).toBe(true);
        expect(await verifyPassword('111111', user.password_hash)).toBe(false);
        expect(user).not.toHaveProperty('password_show');
    });

    test('restricted reset sessions can reach PIN change but not normal patient operations', async () => {
        const token = signAccessToken({ _id: objectId.toString(), role: 'patient', sid: '12345678-1234-4234-8234-123456789012', audience: TokenAudienceEnum.MOBILE, restricted: true });
        spyOn(sessionService, 'validateAccess').mockResolvedValue({ sid: '12345678-1234-4234-8234-123456789012', userId: objectId.toString(), role: 'patient', audience: TokenAudienceEnum.MOBILE, restricted: true, currentRefreshDigest: 'hash', createdAt: '', lastSeenAt: '', lastRefreshedAt: '', expiresAt: '' });
        const app = new Elysia().use(AuthPlugin(TokenAudienceEnum.MOBILE))
            .get('/api/mobile/normal', () => ({ ok: true }))
            .get('/api/mobile/auth/pin/change-required', () => ({ ok: true }));
        const headers = { authorization: `Bearer ${token}` };
        expect((await app.handle(new Request('http://localhost/api/mobile/normal', { headers }))).status).toBe(403);
        expect((await app.handle(new Request('http://localhost/api/mobile/auth/pin/change-required', { headers }))).status).toBe(200);
    });

    test('dedicated admin permissions reject unauthorized staff and allow explicit permission/super admin', async () => {
        const find = spyOn(Admin, 'findOne').mockReturnValue(query(null) as never);
        await expect(requireAdminPermission('doctor', objectId.toString(), IAdminPermissionEnum.VIEW_AUTH_AUDIT)).rejects.toThrow('غير مصرح');
        await expect(requireAdminPermission('admin', objectId.toString(), IAdminPermissionEnum.VIEW_AUTH_AUDIT)).rejects.toThrow('صلاحية');
        find.mockReturnValue(query({ super_admin: false, permissions: [IAdminPermissionEnum.VIEW_AUTH_AUDIT] }) as never);
        await expect(requireAdminPermission('admin', objectId.toString(), IAdminPermissionEnum.VIEW_AUTH_AUDIT)).resolves.toBeDefined();
    });

    test('dashboard auth events paginate, filter, aggregate metrics, and order timelines chronologically', async () => {
        const aggregate = spyOn(AuthEvent, 'aggregate').mockReturnValue(query([{ data: [{ type: 'OTP_SENT' }], count: [{ count: 1 }] }]) as never);
        const listed = await authEventService.list({ phone: '0770' }, 2, 10);
        expect(listed).toEqual({ data: [{ type: 'OTP_SENT' }], count: 1, page: 2, limit: 10 });
        const pipeline = (aggregate.mock.calls[0] as any)[0];
        expect(pipeline[0]).toEqual({ $match: { phone: '0770' } }); expect(pipeline[1].$facet.data).toContainEqual({ $skip: 10 });

        let sort: unknown;
        spyOn(AuthEvent, 'find').mockReturnValue({ sort(value: unknown) { sort = value; return this; }, lean() { return this; }, exec: async () => [{ type: 'PHONE_STARTED' }, { type: 'OTP_SENT' }] } as never);
        expect((await authEventService.timeline('flow')).map(event => event.type)).toEqual(['PHONE_STARTED', 'OTP_SENT']);
        expect(sort).toEqual({ createdAt: 1 });

        aggregate.mockReturnValue(query([{ _id: 'OTP_SENT', count: 4 }]) as never);
        expect(await authEventService.metrics({ success: true })).toEqual([{ _id: 'OTP_SENT', count: 4 }]);
    });
});
