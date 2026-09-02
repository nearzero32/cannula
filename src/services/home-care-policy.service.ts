import Admin from '../models/admins.model';
import { IUserRoleEnum, type IUserRole } from '../interfaces/user.interface';
import { IAdminPermissionEnum } from '../interfaces/admin.interface';

export type HomeCareAccess = 'read' | 'manage' | 'none';

export function canModifyHomeCarePrice(access: HomeCareAccess | null | undefined): boolean {
    return access === 'manage';
}

export function resolveHomeCareAccess(
    role: IUserRole,
    admin: { is_active: boolean; super_admin: boolean; permissions?: string[] } | null
): HomeCareAccess {
    if (role !== IUserRoleEnum.ADMIN || !admin?.is_active) return 'none';
    return admin.super_admin || admin.permissions?.includes(IAdminPermissionEnum.MANAGE_HOME_CARE) ? 'manage' : 'none';
}

class HomeCarePolicyService {
    public async getAccess(userId: string, role: IUserRole): Promise<HomeCareAccess> {
        if (role !== IUserRoleEnum.ADMIN) return 'none';
        const admin = await Admin.findOne({ user_id: userId }).select({ is_active: 1, super_admin: 1, permissions: 1 }).lean();
        return resolveHomeCareAccess(role, admin);
    }
}

export default new HomeCarePolicyService();
