import type mongoose from 'mongoose';
import type { IBaseDocument } from './common.interface';

export const IAdminPermissionEnum = {
    MANAGE_USERS: 'manage_users',
    MANAGE_DOCTORS: 'manage_doctors',
    MANAGE_PATIENTS: 'manage_patients',
    MANAGE_APPOINTMENTS: 'manage_appointments',
    MANAGE_CLINICS: 'manage_clinics',
    MANAGE_SPECIALTIES: 'manage_specialties',
    VERIFY_DOCTORS: 'verify_doctors',
    MANAGE_PAYMENTS: 'manage_payments',
    VIEW_REPORTS: 'view_reports',
    MANAGE_SETTINGS: 'manage_settings',
    VIEW_AUDIT_LOGS: 'view_audit_logs',
    VIEW_AUTH_AUDIT: 'view_auth_audit',
    ISSUE_SUPPORT_OTP: 'issue_support_otp',
    RESET_PATIENT_PIN: 'reset_patient_pin',
    REVOKE_PATIENT_SESSIONS: 'revoke_patient_sessions',
    MANAGE_HOME_CARE: 'manage_home_care',
    MANAGE_PHARMACY_REQUESTS: 'manage_pharmacy_requests',
} as const;

export type IAdminPermission = (typeof IAdminPermissionEnum)[keyof typeof IAdminPermissionEnum];

export interface IAdmin extends IBaseDocument {
    user_id: mongoose.Types.ObjectId;
    display_name: string;
    job_title?: string | null;
    permissions: IAdminPermission[];
    super_admin: boolean;
    is_active: boolean;
    created_by?: mongoose.Types.ObjectId | null;
    last_action_at?: Date | null;
}
