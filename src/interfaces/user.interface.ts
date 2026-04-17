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
    fullName: string;
    email?: string;
    phone: string;
    passwordHash: string;
    role: IUserRole;
    status: IUserStatus;
    isPhoneVerified: boolean;
    isEmailVerified: boolean;
    lastLoginAt?: Date;
}
