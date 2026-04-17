import type mongoose from 'mongoose';

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
} as const;

export type IAdminPermission = (typeof IAdminPermissionEnum)[keyof typeof IAdminPermissionEnum];

export interface IAdmin {
    _id: string;
    userId: mongoose.Types.ObjectId;
    displayName: string;
    jobTitle?: string | null;
    permissions: IAdminPermission[];
    superAdmin: boolean;
    isActive: boolean;
    createdBy?: mongoose.Types.ObjectId | null;
    lastActionAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
}
