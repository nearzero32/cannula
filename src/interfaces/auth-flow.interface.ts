import type mongoose from 'mongoose';
import type { IBaseDocument } from './common.interface';

export const AuthFlowStepEnum = {
    OTP: 'OTP',
    CREATE_PIN: 'CREATE_PIN',
    PIN: 'PIN',
    COMPLETED: 'COMPLETED',
    LOCKED: 'LOCKED',
} as const;
export type AuthFlowStep = (typeof AuthFlowStepEnum)[keyof typeof AuthFlowStepEnum];

export interface IAuthFlow extends IBaseDocument {
    flow_id: string;
    phone: string;
    step: AuthFlowStep;
    user_id?: mongoose.Types.ObjectId | null;
    patient_id?: mongoose.Types.ObjectId | null;
    otp_hash?: string | null;
    support_otp_hash?: string | null;
    otp_expires_at?: Date | null;
    support_otp_expires_at?: Date | null;
    otp_verified_at?: Date | null;
    otp_attempts: number;
    resend_count: number;
    login_attempts: number;
    support_issue_count: number;
    consumed_at?: Date | null;
    expires_at: Date;
    ip_address?: string;
}

export const AuthEventTypeEnum = {
    PHONE_STARTED: 'PHONE_STARTED', OTP_REQUESTED: 'OTP_REQUESTED', OTP_SENT: 'OTP_SENT',
    OTP_SEND_FAILED: 'OTP_SEND_FAILED', OTP_RESENT: 'OTP_RESENT', OTP_VERIFICATION_FAILED: 'OTP_VERIFICATION_FAILED',
    OTP_VERIFIED: 'OTP_VERIFIED', OTP_EXPIRED: 'OTP_EXPIRED', OTP_RATE_LIMITED: 'OTP_RATE_LIMITED',
    ACCOUNT_CREATION_STARTED: 'ACCOUNT_CREATION_STARTED', ACCOUNT_CREATED: 'ACCOUNT_CREATED', PIN_CREATED: 'PIN_CREATED',
    LOGIN_ATTEMPT: 'LOGIN_ATTEMPT', LOGIN_SUCCESS: 'LOGIN_SUCCESS', LOGIN_FAILED: 'LOGIN_FAILED', LOGIN_RATE_LIMITED: 'LOGIN_RATE_LIMITED',
    SUPPORT_OTP_ISSUED: 'SUPPORT_OTP_ISSUED', SUPPORT_OTP_USED: 'SUPPORT_OTP_USED', SUPPORT_OTP_EXPIRED: 'SUPPORT_OTP_EXPIRED',
    ADMIN_PATIENT_PIN_RESET: 'ADMIN_PATIENT_PIN_RESET', PATIENT_FORCED_PIN_CHANGED: 'PATIENT_FORCED_PIN_CHANGED',
    SESSION_REVOKED: 'SESSION_REVOKED', ALL_SESSIONS_REVOKED: 'ALL_SESSIONS_REVOKED',
} as const;
export type AuthEventType = (typeof AuthEventTypeEnum)[keyof typeof AuthEventTypeEnum];
