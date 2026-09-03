import crypto from 'crypto';
import mongoose from 'mongoose';
import AuthFlow from '../models/auth-flow.model';
import User from '../models/users.model';
import Patient from '../models/patients.model';
import PatientHealthProfile from '../models/patient-health-profile.model';
import AuthEvent from '../models/auth-event.model';
import userService from './user.service';
import patientService from './patient.service';
import authEventService from './auth-event.service';
import otpDeliveryService from './otp-delivery.service';
import { AuthEventTypeEnum as E, AuthFlowStepEnum as S } from '../interfaces/auth-flow.interface';
import { IUserRoleEnum, IUserStatusEnum } from '../interfaces/user.interface';
import { IPatientStatusEnum } from '../interfaces/patient.interface';
import { DomainError } from './domain-error';
import { hashPassword, verifyPassword } from '../constants/hashing';
import { TokenAudienceEnum } from '../constants/jwt';
import sessionService from './session.service';
import { isOtpDebugReturnEnabled } from '../config/otp-debug.config';

const FLOW_TTL_MS = 10 * 60_000, OTP_TTL_MS = 5 * 60_000, SUPPORT_TTL_MS = 3 * 60_000;
const MAX_OTP_ATTEMPTS = 5, MAX_RESENDS = 3, MAX_PIN_ATTEMPTS = 5;
export const PIN_PATTERN = /^\d{6}$/;

export function normalizePhone(phone: string): string {
    const normalized = phone.trim().replace(/[\s()-]/g, '');
    if (!/^\+?\d{7,15}$/.test(normalized)) throw new DomainError('رقم الهاتف غير صالح', 400);
    return normalized;
}
function code(): string { return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0'); }
function codeHash(value: string): string {
    const secret = process.env.OTP_HASH_SECRET || process.env.ACCESS_TOKEN_SECRET;
    if (!secret) throw new Error('OTP_HASH_SECRET or ACCESS_TOKEN_SECRET is required');
    return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

class PatientAuthService {
    async start(phoneInput: string, context: { ip?: string } = {}) {
        const phone = normalizePhone(phoneInput), now = new Date();
        const recentScope = context.ip ? { $or: [{ phone }, { ip_address: context.ip }] } : { phone };
        const recent = await AuthFlow.countDocuments({ ...recentScope, createdAt: { $gte: new Date(now.getTime() - 5 * 60_000) } }).exec();
        if (recent >= 5) { await authEventService.record({ phone, type: E.OTP_RATE_LIMITED, success: false, reason_code: 'START_RATE_LIMITED', ip_address: context.ip }); throw new DomainError('طلبات كثيرة، حاول لاحقاً', 429); }
        const user = await User.findOne({ phone, role: IUserRoleEnum.PATIENT }).select('_id').exec();
        const flowId = crypto.randomUUID();
        const flow = await AuthFlow.create({ flow_id: flowId, phone, user_id: user?._id ?? null, step: user ? S.PIN : S.OTP, expires_at: new Date(now.getTime() + FLOW_TTL_MS), ip_address: context.ip ?? '' });
        await authEventService.record({ flow_id: flowId, phone, user_id: user?._id, type: E.PHONE_STARTED, success: true, ip_address: context.ip });
        if (user) return { flowId, nextStep: S.PIN };
        const challenge = await this.sendOtp(flow, false, context.ip);
        return { flowId, nextStep: S.OTP, ...challenge };
    }

    private async sendOtp(flow: any, resend: boolean, ip?: string) {
        if (flow.resend_count >= MAX_RESENDS) { await authEventService.record({ flow_id: flow.flow_id, phone: flow.phone, type: E.OTP_RATE_LIMITED, success: false, reason_code: 'OTP_RESEND_RATE_LIMITED', ip_address: ip }); throw new DomainError('تم تجاوز عدد مرات إعادة الإرسال', 429); }
        const otp = code(), expiresAt = new Date(Date.now() + OTP_TTL_MS);
        await authEventService.record({ flow_id: flow.flow_id, phone: flow.phone, type: resend ? E.OTP_RESENT : E.OTP_REQUESTED, success: true, ip_address: ip });
        await AuthFlow.updateOne({ _id: flow._id, step: S.OTP }, { $set: { otp_hash: codeHash(otp), otp_expires_at: expiresAt }, $inc: { resend_count: 1 } }).exec();
        try { await otpDeliveryService.send(flow.phone, otp); await authEventService.record({ flow_id: flow.flow_id, phone: flow.phone, type: E.OTP_SENT, success: true, ip_address: ip }); }
        catch (error) { await AuthFlow.updateOne({ _id: flow._id }, { $unset: { otp_hash: 1, otp_expires_at: 1 } }).exec(); await authEventService.record({ flow_id: flow.flow_id, phone: flow.phone, type: E.OTP_SEND_FAILED, success: false, reason_code: 'PROVIDER_FAILURE', ip_address: ip }); throw new DomainError('تعذر إرسال رمز التحقق', 503); }
        return { expiresAt: expiresAt.toISOString(), ...(isOtpDebugReturnEnabled() ? { debugOtp: otp } : {}) };
    }

    async resend(flowId: string, ip?: string) {
        const flow = await AuthFlow.findOne({ flow_id: flowId }).select('+otp_hash +support_otp_hash').exec();
        this.requireFlow(flow, S.OTP);
        const challenge = await this.sendOtp(flow, true, ip);
        return { flowId, nextStep: S.OTP, ...challenge };
    }

    async verifyOtp(flowId: string, otp: string, ip?: string) {
        const flow = await AuthFlow.findOne({ flow_id: flowId }).select('+otp_hash +support_otp_hash').exec();
        this.requireFlow(flow, S.OTP);
        if (flow!.otp_attempts >= MAX_OTP_ATTEMPTS) throw new DomainError('تم تجاوز محاولات التحقق', 429);
        const now = new Date(), normalValid = Boolean(flow!.otp_hash && flow!.otp_expires_at && flow!.otp_expires_at > now && codeHash(otp) === flow!.otp_hash);
        const supportValid = Boolean(flow!.support_otp_hash && flow!.support_otp_expires_at && flow!.support_otp_expires_at > now && codeHash(otp) === flow!.support_otp_hash);
        if (!normalValid && !supportValid) {
            await AuthFlow.updateOne({ _id: flow!._id, step: S.OTP }, { $inc: { otp_attempts: 1 } }).exec();
            const anyActive = Boolean((flow!.otp_hash && flow!.otp_expires_at && flow!.otp_expires_at > now) || (flow!.support_otp_hash && flow!.support_otp_expires_at && flow!.support_otp_expires_at > now));
            const expired = !anyActive;
            await authEventService.record({ flow_id: flowId, phone: flow!.phone, type: expired ? E.OTP_EXPIRED : E.OTP_VERIFICATION_FAILED, success: false, reason_code: expired ? 'OTP_EXPIRED' : 'OTP_INVALID', ip_address: ip });
            throw new DomainError(expired ? 'انتهت صلاحية رمز التحقق' : 'رمز التحقق غير صحيح', 400);
        }
        const updated = await AuthFlow.findOneAndUpdate({ _id: flow!._id, step: S.OTP, otp_verified_at: null }, { $set: { step: S.CREATE_PIN, otp_verified_at: now }, $unset: { otp_hash: 1, support_otp_hash: 1, otp_expires_at: 1, support_otp_expires_at: 1 } }, { returnDocument: 'after' }).exec();
        if (!updated) throw new DomainError('تم استخدام رمز التحقق مسبقاً', 409);
        await authEventService.record({ flow_id: flowId, phone: flow!.phone, type: supportValid ? E.SUPPORT_OTP_USED : E.OTP_VERIFIED, success: true, ip_address: ip });
        return { nextStep: S.CREATE_PIN };
    }

    async createPin(flowId: string, pin: string, device: Record<string, string | undefined> = {}, ip?: string) {
        if (!PIN_PATTERN.test(pin)) throw new DomainError('الرمز السري يجب أن يتكون من 6 أرقام', 400);
        const now = new Date();
        const flow = await AuthFlow.findOneAndUpdate({ flow_id: flowId, step: S.CREATE_PIN, otp_verified_at: { $ne: null }, consumed_at: null, expires_at: { $gt: now } }, { $set: { consumed_at: now } }, { returnDocument: 'after' }).exec();
        if (!flow) throw new DomainError('تدفق المصادقة غير صالح أو مستخدم', 409);
        await authEventService.record({ flow_id: flowId, phone: flow.phone, type: E.ACCOUNT_CREATION_STARTED, success: true });
        let user: any, patient: any;
        try {
            user = await userService.create({ full_name: flow.phone, phone: flow.phone, password_hash: await hashPassword(pin), role: IUserRoleEnum.PATIENT, status: IUserStatusEnum.ACTIVE, is_phone_verified: true, is_email_verified: false, must_change_pin: false });
            patient = await patientService.create({ user_id: user._id as mongoose.Types.ObjectId, full_name: flow.phone, phone: flow.phone, status: IPatientStatusEnum.ACTIVE });
            await AuthFlow.updateOne({ _id: flow._id }, { $set: { step: S.COMPLETED, user_id: user._id, patient_id: patient._id } }).exec();
            await authEventService.record({ flow_id: flowId, phone: flow.phone, user_id: user._id, patient_id: patient._id, type: E.ACCOUNT_CREATED, success: true });
            await authEventService.record({ flow_id: flowId, phone: flow.phone, user_id: user._id, patient_id: patient._id, type: E.PIN_CREATED, success: true });
            const tokens = await sessionService.create(user, TokenAudienceEnum.MOBILE, device, ip);
            await authEventService.record({ flow_id: flowId, phone: flow.phone, user_id: user._id, patient_id: patient._id, type: E.LOGIN_SUCCESS, success: true, metadata: device, ip_address: ip });
            return { ...tokens, user: { _id: String(user._id), phone: user.phone, role: user.role, status: user.status }, patient: { _id: String(patient._id), profile_completed: false } };
        } catch (error) {
            if (patient?._id) await PatientHealthProfile.deleteOne({ patient_id: patient._id }).exec();
            if (user?._id) { await sessionService.revokeAll(String(user._id), { reasonCode: 'ACCOUNT_CREATION_ROLLBACK' }); await Patient.deleteOne({ user_id: user._id }).exec(); await User.deleteOne({ _id: user._id }).exec(); }
            await AuthFlow.updateOne({ _id: flow._id, step: { $ne: S.COMPLETED } }, { $set: { consumed_at: null } }).exec();
            if ((error as any)?.code === 11000) throw new DomainError('رقم الهاتف مسجل مسبقاً', 409);
            throw error;
        }
    }

    async login(flowId: string, pin: string, device: Record<string, string | undefined> = {}, ip?: string) {
        if (!PIN_PATTERN.test(pin)) throw new DomainError('الرمز السري يجب أن يتكون من 6 أرقام', 400);
        const flow = await AuthFlow.findOne({ flow_id: flowId, step: S.PIN }).exec(); this.requireFlow(flow, S.PIN);
        const recentFailures = await AuthEvent.countDocuments({ phone: flow!.phone, type: E.LOGIN_FAILED, createdAt: { $gte: new Date(Date.now() - 15 * 60_000) } }).exec();
        if (flow!.login_attempts >= MAX_PIN_ATTEMPTS || recentFailures >= MAX_PIN_ATTEMPTS) { await authEventService.record({ flow_id: flowId, phone: flow!.phone, user_id: flow!.user_id, type: E.LOGIN_RATE_LIMITED, success: false }); throw new DomainError('تم تجاوز محاولات تسجيل الدخول', 429); }
        const user = await User.findOne({ _id: flow!.user_id, role: IUserRoleEnum.PATIENT }).select('+password_hash').exec();
        await authEventService.record({ flow_id: flowId, phone: flow!.phone, user_id: flow!.user_id, type: E.LOGIN_ATTEMPT, success: true, metadata: device, ip_address: ip });
        if (!user || user.status !== IUserStatusEnum.ACTIVE || !(await verifyPassword(pin, user.password_hash))) {
            await AuthFlow.updateOne({ _id: flow!._id }, { $inc: { login_attempts: 1 } }).exec();
            await authEventService.record({ flow_id: flowId, phone: flow!.phone, user_id: flow!.user_id, type: E.LOGIN_FAILED, success: false, reason_code: 'INVALID_PIN', metadata: device, ip_address: ip });
            throw new DomainError('رقم الهاتف أو الرمز السري غير صحيح', 401);
        }
        user.last_login_at = new Date(); await user.save(); const tokens = await sessionService.create(user, TokenAudienceEnum.MOBILE, device, ip);
        const patient = await Patient.findOne({ user_id: user._id }).select('_id').lean().exec();
        await AuthFlow.updateOne({ _id: flow!._id }, { $set: { step: S.COMPLETED, consumed_at: new Date(), patient_id: patient?._id } }).exec();
        await authEventService.record({ flow_id: flowId, phone: flow!.phone, user_id: user._id, patient_id: patient?._id, type: E.LOGIN_SUCCESS, success: true, metadata: device, ip_address: ip });
        return { ...tokens, user: { _id: String(user._id), phone: user.phone, role: user.role, status: user.status } };
    }

    async changeRequiredPin(userId: string, restrictedSid: string, pin: string) {
        if (!PIN_PATTERN.test(pin)) throw new DomainError('الرمز السري يجب أن يتكون من 6 أرقام', 400);
        const user = await User.findOne({ _id: userId, role: IUserRoleEnum.PATIENT, must_change_pin: true }).select('+password_hash').exec();
        if (!user) throw new DomainError('تغيير الرمز السري غير مطلوب', 409);
        const oldSession = await sessionService.get(userId, restrictedSid);
        if (!oldSession?.restricted) throw new DomainError('جلسة تغيير الرمز السري غير صالحة', 403, 'RESTRICTED_SESSION_REQUIRED');
        user.password_hash = await hashPassword(pin); user.must_change_pin = false; await user.save();
        await sessionService.revokeAll(userId, { phone: user.phone, reasonCode: 'REQUIRED_PIN_CHANGED' });
        await authEventService.record({ phone: user.phone, user_id: user._id, type: E.PATIENT_FORCED_PIN_CHANGED, success: true });
        return await sessionService.create(user, TokenAudienceEnum.MOBILE, {
            deviceId: oldSession.deviceId, deviceName: oldSession.deviceName, platform: oldSession.platform,
        });
    }

    async issueSupportOtp(flowId: string, reason: string, actorUserId: string, ip?: string) {
        const supportOtp = code(), now = new Date();
        const flow = await AuthFlow.findOneAndUpdate({
            flow_id: flowId, step: S.OTP, expires_at: { $gt: now },
            createdAt: { $gte: new Date(now.getTime() - FLOW_TTL_MS) }, support_issue_count: { $lt: 2 },
        }, { $set: { support_otp_hash: codeHash(supportOtp), support_otp_expires_at: new Date(now.getTime() + SUPPORT_TTL_MS) }, $inc: { support_issue_count: 1 } }, { returnDocument: 'after' }).exec();
        if (!flow) throw new DomainError('لا يمكن إصدار رمز دعم لهذا التدفق', 429);
        await authEventService.record({ flow_id: flowId, phone: flow.phone, type: E.SUPPORT_OTP_ISSUED, success: true, actor_type: 'admin', actor_user_id: actorUserId, ip_address: ip, metadata: { reason } });
        return { supportOtp, expiresAt: flow.support_otp_expires_at };
    }

    async adminResetPin(patientId: string, reason: string, actorUserId: string, ip?: string) {
        if (!mongoose.Types.ObjectId.isValid(patientId)) throw new DomainError('معرف المريض غير صالح', 400);
        const patient = await Patient.findById(patientId).exec();
        if (!patient) throw new DomainError('المريض غير موجود', 404);
        const temporaryPin = code(), hash = await hashPassword(temporaryPin);
        const currentUser = await User.findOne({ _id: patient.user_id, role: IUserRoleEnum.PATIENT }).exec();
        if (!currentUser) throw new DomainError('حساب المريض غير موجود', 404);
        await sessionService.revokeAll(String(currentUser._id), { phone: currentUser.phone, patientId: String(patient._id), actorType: 'admin', actorUserId, reasonCode: 'ADMIN_PIN_RESET', ip });
        const user = await User.findOneAndUpdate({ _id: patient.user_id, role: IUserRoleEnum.PATIENT }, { $set: { password_hash: hash, must_change_pin: true } }, { returnDocument: 'after' }).exec();
        if (!user) throw new DomainError('حساب المريض غير موجود', 404);
        await authEventService.record({ phone: user.phone, user_id: user._id, patient_id: patient._id as any, type: E.ADMIN_PATIENT_PIN_RESET, success: true, actor_type: 'admin', actor_user_id: actorUserId, ip_address: ip, metadata: { reason } });
        return { temporaryPin, mustChangePin: true };
    }

    async revokePatientSessions(patientId: string, actorUserId: string, reason?: string, ip?: string) {
        if (!mongoose.Types.ObjectId.isValid(patientId)) throw new DomainError('معرف المريض غير صالح', 400);
        const patient = await Patient.findById(patientId).exec();
        if (!patient) throw new DomainError('المريض غير موجود', 404);
        const user = await User.findById(patient.user_id).exec();
        if (!user) throw new DomainError('حساب المريض غير موجود', 404);
        const revoked = await sessionService.revokeAll(String(user._id), { phone: user.phone, patientId: String(patient._id), actorType: 'admin', actorUserId, reasonCode: 'ADMIN_SESSION_REVOCATION', ip });
        return { revokedSessionsCount: revoked };
    }

    async securityDetails(patientId: string) {
        if (!mongoose.Types.ObjectId.isValid(patientId)) throw new DomainError('معرف المريض غير صالح', 400);
        const patient = await Patient.findById(patientId).lean().exec();
        if (!patient) throw new DomainError('المريض غير موجود', 404);
        const user = await User.findById(patient.user_id).lean().exec();
        if (!user) throw new DomainError('حساب المريض غير موجود', 404);
        const [lastSuccess, lastFailed, sessions] = await Promise.all([
            AuthEvent.findOne({ user_id: user._id, type: E.LOGIN_SUCCESS }).sort({ createdAt: -1 }).select('createdAt').lean().exec(),
            AuthEvent.findOne({ user_id: user._id, type: E.LOGIN_FAILED }).sort({ createdAt: -1 }).select('createdAt').lean().exec(),
            sessionService.count(String(user._id)),
        ]);
        return { phone: user.phone, accountStatus: user.status, phoneVerified: user.is_phone_verified, mustChangePin: user.must_change_pin, createdAt: user.createdAt, lastSuccessfulLogin: lastSuccess?.createdAt ?? null, lastFailedLogin: lastFailed?.createdAt ?? null, activeSessionCount: sessions };
    }

    private requireFlow(flow: any, step: string): void {
        if (!flow) throw new DomainError('تدفق المصادقة غير موجود', 404);
        if (flow.expires_at <= new Date()) throw new DomainError('انتهت صلاحية تدفق المصادقة', 400);
        if (flow.step !== step) throw new DomainError('حالة تدفق المصادقة غير صالحة', 409);
    }
}
export default new PatientAuthService();
