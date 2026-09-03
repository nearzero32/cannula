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
import securityRateLimitService from './security-rate-limit.service';

const FLOW_TTL_MS = 10 * 60_000, OTP_TTL_MS = 5 * 60_000, SUPPORT_TTL_MS = 3 * 60_000;
const MAX_OTP_ATTEMPTS = 5, MAX_RESENDS = 3, MAX_PIN_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SECONDS = 45;
export const PIN_PATTERN = /^\d{6}$/;

export function normalizePhone(phone: string): string {
    let normalized = phone.trim().replace(/[\s()-]/g, '');
    if (normalized.startsWith('00964')) normalized = `+964${normalized.slice(5)}`;
    if (normalized.startsWith('+964')) normalized = `0${normalized.slice(4).replace(/^0/, '')}`;
    if (!/^\d{7,15}$/.test(normalized)) throw new DomainError('رقم الهاتف غير صالح', 400, 'AUTH_PHONE_INVALID');
    return normalized;
}
function code(): string { return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0'); }
function codeHash(value: string): string {
    const secret = process.env.OTP_HASH_SECRET;
    if (!secret) throw new Error('OTP_HASH_SECRET is required');
    return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

class PatientAuthService {
    async start(phoneInput: string, context: { ip?: string } = {}) {
        const phone = normalizePhone(phoneInput), now = new Date();
        await securityRateLimitService.enforce('OTP_START_PHONE',phone);
        if(context.ip)await securityRateLimitService.enforce('OTP_START_IP',context.ip);
        const user = await User.findOne({ phone, role: IUserRoleEnum.PATIENT }).select('_id').exec();
        const flowId = crypto.randomUUID();
        const flow = await AuthFlow.create({ flow_id: flowId, phone, user_id: user?._id ?? null, step: user ? S.PIN : S.OTP, expires_at: new Date(now.getTime() + FLOW_TTL_MS), ip_address: context.ip ?? '' });
        await authEventService.record({ flow_id: flowId, phone, user_id: user?._id, type: E.PHONE_STARTED, success: true, ip_address: context.ip });
        if (user) return { flowId, nextStep: S.PIN };
        const challenge = await this.sendOtp(flow, false, context.ip);
        return { flowId, nextStep: S.OTP, ...challenge };
    }

    private async sendOtp(flow: any, resend: boolean, ip?: string) {
        const otp = code(), expiresAt = new Date(Date.now() + OTP_TTL_MS);
        const updated=await AuthFlow.findOneAndUpdate({_id:flow._id,step:S.OTP,expires_at:{$gt:new Date()}},{$set:{otp_hash:codeHash(otp),otp_expires_at:expiresAt,otp_last_sent_at:new Date()}},{returnDocument:'after'}).exec();
        if(!updated)throw new DomainError('حالة تدفق المصادقة غير صالحة',409,'AUTH_FLOW_COMPLETED');
        await authEventService.record({ flow_id: flow.flow_id, phone: flow.phone, type: resend ? E.OTP_RESENT : E.OTP_REQUESTED, success: true, ip_address: ip });
        try { await otpDeliveryService.send(flow.phone, otp); await authEventService.record({ flow_id: flow.flow_id, phone: flow.phone, type: E.OTP_SENT, success: true, ip_address: ip }); }
        catch (error) { await AuthFlow.updateOne({ _id: flow._id }, { $unset: { otp_hash: 1, otp_expires_at: 1 } }).exec(); await authEventService.record({ flow_id: flow.flow_id, phone: flow.phone, type: E.OTP_SEND_FAILED, success: false, reason_code: 'PROVIDER_FAILURE', ip_address: ip }); throw new DomainError('تعذر إرسال رمز التحقق', 503); }
        return { expiresAt: expiresAt.toISOString(), ...(isOtpDebugReturnEnabled() ? { debugOtp: otp } : {}) };
    }

    async resend(flowId: string, ip?: string) {
        const existing=await AuthFlow.findOne({flow_id:flowId}).exec();this.requireFlow(existing,S.OTP);
        await securityRateLimitService.enforce('OTP_RESEND_PHONE',existing!.phone);if(ip)await securityRateLimitService.enforce('OTP_RESEND_IP',ip);
        const otp=code(),now=new Date(),expiresAt=new Date(now.getTime()+OTP_TTL_MS),cooldownBefore=new Date(now.getTime()-OTP_RESEND_COOLDOWN_SECONDS*1000);
        const flow=await AuthFlow.findOneAndUpdate({flow_id:flowId,step:S.OTP,expires_at:{$gt:now},resend_count:{$lt:MAX_RESENDS},$or:[{otp_last_sent_at:null},{otp_last_sent_at:{$lte:cooldownBefore}}]},{$set:{otp_hash:codeHash(otp),otp_expires_at:expiresAt,otp_last_sent_at:now},$inc:{resend_count:1}},{returnDocument:'after'}).exec();
        if(!flow){const current=await AuthFlow.findOne({flow_id:flowId}).exec();this.requireFlow(current,S.OTP);if(current!.resend_count>=MAX_RESENDS)throw new DomainError('تم تجاوز عدد مرات إعادة الإرسال',429,'AUTH_OTP_RESEND_LIMIT');const retry=Math.max(1,Math.ceil((OTP_RESEND_COOLDOWN_SECONDS*1000-(now.getTime()-(current!.otp_last_sent_at?.getTime()??0)))/1000));const error=new DomainError('انتظر قبل إعادة إرسال الرمز',429,'AUTH_OTP_RESEND_COOLDOWN') as DomainError&{retryAfterSeconds?:number};error.retryAfterSeconds=retry;throw error}
        try{await otpDeliveryService.send(flow.phone,otp);await authEventService.record({flow_id:flowId,phone:flow.phone,type:E.OTP_RESENT,success:true,ip_address:ip})}catch{await AuthFlow.updateOne({_id:flow._id,otp_hash:codeHash(otp)},{$unset:{otp_hash:1,otp_expires_at:1}}).exec();throw new DomainError('تعذر إرسال رمز التحقق',503,'OTP_PROVIDER_FAILURE')}
        return{flowId,nextStep:S.OTP,expiresAt:expiresAt.toISOString(),...(isOtpDebugReturnEnabled()?{debugOtp:otp}:{})};
    }

    async verifyOtp(flowId: string, otp: string, ip?: string) {
        const seed=await AuthFlow.findOne({flow_id:flowId}).exec();this.requireFlow(seed,S.OTP);await securityRateLimitService.enforce('OTP_VERIFY_PHONE',seed!.phone);if(ip)await securityRateLimitService.enforce('OTP_VERIFY_IP',ip);
        const now=new Date(),hash=codeHash(otp),match={$or:[{otp_hash:hash,otp_expires_at:{$gt:now}},{support_otp_hash:hash,support_otp_expires_at:{$gt:now}}]};
        const consumed=await AuthFlow.findOneAndUpdate({flow_id:flowId,step:S.OTP,expires_at:{$gt:now},otp_attempts:{$lt:MAX_OTP_ATTEMPTS},...match},{$set:{step:S.CREATE_PIN,otp_verified_at:now},$unset:{otp_hash:1,support_otp_hash:1,otp_expires_at:1,support_otp_expires_at:1}},{returnDocument:'before'}).select('+otp_hash +support_otp_hash').exec();
        if(!consumed){const active={$or:[{otp_hash:{$ne:null},otp_expires_at:{$gt:now}},{support_otp_hash:{$ne:null},support_otp_expires_at:{$gt:now}}]};const failed=await AuthFlow.findOneAndUpdate({flow_id:flowId,step:S.OTP,expires_at:{$gt:now},otp_attempts:{$lt:MAX_OTP_ATTEMPTS},$and:[active,{$nor:[{otp_hash:hash,otp_expires_at:{$gt:now}},{support_otp_hash:hash,support_otp_expires_at:{$gt:now}}]}]},{$inc:{otp_attempts:1}},{returnDocument:'after'}).exec();if(failed){await authEventService.record({flow_id:flowId,phone:failed.phone,type:E.OTP_VERIFICATION_FAILED,success:false,reason_code:'OTP_INVALID',ip_address:ip});throw new DomainError('رمز التحقق غير صحيح',400,'AUTH_OTP_INVALID')}const state=await AuthFlow.findOne({flow_id:flowId}).select('+otp_hash +support_otp_hash').exec();if(state?.step!==S.OTP||(state?.otp_hash===hash&&state.otp_expires_at&&state.otp_expires_at>now)||(state?.support_otp_hash===hash&&state.support_otp_expires_at&&state.support_otp_expires_at>now))throw new DomainError('تم استخدام رمز التحقق مسبقاً',409,'AUTH_OTP_ALREADY_USED');if((state?.otp_attempts??MAX_OTP_ATTEMPTS)>=MAX_OTP_ATTEMPTS)throw new DomainError('تم تجاوز محاولات التحقق',429,'AUTH_OTP_ATTEMPTS_EXCEEDED');throw new DomainError('انتهت صلاحية رمز التحقق',400,'AUTH_OTP_EXPIRED')}
        await authEventService.record({flow_id:flowId,phone:consumed.phone,type:consumed.support_otp_hash===hash?E.SUPPORT_OTP_USED:E.OTP_VERIFIED,success:true,ip_address:ip});
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
        await securityRateLimitService.check('PIN_PHONE',flow!.phone,'AUTH_PIN_RATE_LIMITED');if(ip)await securityRateLimitService.check('PIN_IP',ip,'AUTH_PIN_RATE_LIMITED');
        const user = await User.findOne({ _id: flow!.user_id, role: IUserRoleEnum.PATIENT }).select('+password_hash').exec();
        await authEventService.record({ flow_id: flowId, phone: flow!.phone, user_id: flow!.user_id, type: E.LOGIN_ATTEMPT, success: true, metadata: device, ip_address: ip });
        if (!user || user.status !== IUserStatusEnum.ACTIVE || !(await verifyPassword(pin, user.password_hash))) {
            await securityRateLimitService.enforce('PIN_PHONE',flow!.phone,'AUTH_PIN_RATE_LIMITED');if(ip)await securityRateLimitService.enforce('PIN_IP',ip,'AUTH_PIN_RATE_LIMITED');
            await AuthFlow.updateOne({ _id: flow!._id }, { $inc: { login_attempts: 1 } }).exec();
            await authEventService.record({ flow_id: flowId, phone: flow!.phone, user_id: flow!.user_id, type: E.LOGIN_FAILED, success: false, reason_code: 'INVALID_PIN', metadata: device, ip_address: ip });
            throw new DomainError('رقم الهاتف أو الرمز السري غير صحيح', 401);
        }
        await securityRateLimitService.reset('PIN_PHONE',flow!.phone);
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
        await securityRateLimitService.enforce('SUPPORT_ADMIN',actorUserId);await securityRateLimitService.enforce('SUPPORT_FLOW',flowId);
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
