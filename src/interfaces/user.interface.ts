export const IUserRoleEnum = {
    ADMIN: 'admin',
    DOCTOR: 'doctor',
    PATIENT: 'patient',
} as const;

export type IUserRole = (typeof IUserRoleEnum)[keyof typeof IUserRoleEnum];

export const IUserStatusEnum = {
    PENDING: 'pending',
    ACTIVE: 'active',
    INACTIVE: 'inactive',
    SUSPENDED: 'suspended',
} as const;

export type IUserStatus = (typeof IUserStatusEnum)[keyof typeof IUserStatusEnum];

import type { IBaseDocument } from './common.interface';

export interface IUser extends IBaseDocument {
    full_name: string;
    email?: string;
    phone: string;
    password_hash: string;
    password_show: string;
    role: IUserRole;
    status: IUserStatus;
    is_phone_verified: boolean;
    is_email_verified: boolean;
    last_login_at?: Date;
}
