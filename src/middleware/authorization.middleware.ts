import Elysia from 'elysia';
import type { IUserRole } from '../interfaces/user.interface';
import type { IAdminPermission } from '../interfaces/admin.interface';
import { DomainError } from '../services/domain-error';
import { requireAdminPermission } from '../services/admin-auth-permission.service';

export function requireAnyRole(role: IUserRole | string, allowedRoles: readonly IUserRole[]): void {
    if (!allowedRoles.includes(role as IUserRole)) throw new DomainError('غير مصرح لك بالوصول', 403);
}

export function requireRole(role: IUserRole | string, allowedRole: IUserRole): void {
    requireAnyRole(role, [allowedRole]);
}

/** Applies a role policy to every route registered after this scoped plugin. */
export function RoleGuardPlugin(allowedRoles: readonly IUserRole[]) {
    return new Elysia().onBeforeHandle({ as: 'scoped' }, ({ phrase, set }: any) => {
        try { requireAnyRole(phrase?.role, allowedRoles); }
        catch (error) {
            if (!(error instanceof DomainError)) throw error;
            set.status = error.status;
            return { error: true as const, message: error.message };
        }
    });
}

/** Applies one Admin permission to every route registered after this scoped plugin. */
export function AdminPermissionGuardPlugin(permissionPolicy: IAdminPermission | ((request: Request) => IAdminPermission)) {
    return new Elysia().onBeforeHandle({ as: 'scoped' }, async ({ phrase, request, set }: any) => {
        try {
            const permission = typeof permissionPolicy === 'function' ? permissionPolicy(request) : permissionPolicy;
            await requireAdminPermission(phrase?.role, phrase?._id, permission);
        }
        catch (error) {
            if (!(error instanceof DomainError)) throw error;
            set.status = error.status;
            return { error: true as const, message: error.message };
        }
    });
}
