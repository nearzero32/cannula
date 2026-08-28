import Admin from '../models/admins.model';
import { IUserRoleEnum, type IUserRole } from '../interfaces/user.interface';

export type HomeCareAccess = 'read' | 'manage' | 'none';

export function canModifyHomeCarePrice(access: HomeCareAccess | null | undefined): boolean {
    return access === 'manage';
}

export function resolveHomeCareAccess(
    role: IUserRole,
    admin: { is_active: boolean; super_admin: boolean } | null
): HomeCareAccess {
    if (role !== IUserRoleEnum.ADMIN || !admin?.is_active) return 'none';
    return admin.super_admin ? 'manage' : 'read';
}

class HomeCarePolicyService {
    public async getAccess(userId: string, role: IUserRole): Promise<HomeCareAccess> {
        if (role !== IUserRoleEnum.ADMIN) return 'none';
        const admin = await Admin.findOne({ user_id: userId }).select({ is_active: 1, super_admin: 1 }).lean();
        return resolveHomeCareAccess(role, admin);
    }
}

export default new HomeCarePolicyService();
