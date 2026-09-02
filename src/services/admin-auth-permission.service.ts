import Admin from '../models/admins.model';
import type { IAdminPermission } from '../interfaces/admin.interface';
import { DomainError } from './domain-error';
import { IUserRoleEnum } from '../interfaces/user.interface';

export async function requireAdminPermission(role: string, userId: string, permission: IAdminPermission) {
    if (role !== IUserRoleEnum.ADMIN) throw new DomainError('غير مصرح لك بالوصول', 403);
    const admin = await Admin.findOne({ user_id: userId, is_active: true }).select('permissions super_admin').lean().exec();
    if (!admin || (!admin.super_admin && !admin.permissions.includes(permission))) throw new DomainError('لا توجد صلاحية لتنفيذ الإجراء', 403);
    return admin;
}
