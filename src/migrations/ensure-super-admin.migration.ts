import User, { type UserDocument } from '../models/users.model';
import Admin from '../models/admins.model';
import { hashPassword } from '../constants/hashing';
import { IAdminPermissionEnum } from '../interfaces/admin.interface';
import { IUserRoleEnum, IUserStatusEnum } from '../interfaces/user.interface';
import BootstrapLock from '../models/bootstrap-lock.model';

const INITIAL_SUPER_ADMIN_LOCK = 'initial-super-admin';

type BootstrapErrorCode =
    | 'SUPER_ADMIN_BOOTSTRAP_REQUIRED'
    | 'SUPER_ADMIN_BOOTSTRAP_PASSWORD_TOO_SHORT'
    | 'SUPER_ADMIN_BOOTSTRAP_CONFLICT';

export class SuperAdminBootstrapError extends Error {
    constructor(public readonly code: BootstrapErrorCode) {
        super(code);
        this.name = 'SuperAdminBootstrapError';
    }
}

export async function ensureSuperAdminExists(): Promise<void> {
    const existingSuperAdmin = await Admin.findOne({ super_admin: true }).lean().exec();
    if (existingSuperAdmin) {
        const validUser = await User.findOne({
            _id: existingSuperAdmin.user_id,
            role: IUserRoleEnum.ADMIN,
            status: IUserStatusEnum.ACTIVE,
            password_hash: /^\$argon2id\$/,
        }).select('_id').lean().exec();
        if (!existingSuperAdmin.is_active || !validUser) {
            throw new SuperAdminBootstrapError('SUPER_ADMIN_BOOTSTRAP_CONFLICT');
        }
        return;
    }

    const phone = process.env.SUPER_ADMIN_PHONE?.trim();
    const password = process.env.SUPER_ADMIN_PASSWORD;
    if (!phone || !password) {
        if (process.env.NODE_ENV === 'production') {
            throw new SuperAdminBootstrapError('SUPER_ADMIN_BOOTSTRAP_REQUIRED');
        }
        console.warn('[Migration] Initial Super Admin bootstrap skipped: explicit credentials not configured');
        return;
    }
    if (password.length < 12) {
        throw new SuperAdminBootstrapError('SUPER_ADMIN_BOOTSTRAP_PASSWORD_TOO_SHORT');
    }

    const collision = await User.findOne({ phone }).select('_id').lean().exec();
    if (collision) throw new SuperAdminBootstrapError('SUPER_ADMIN_BOOTSTRAP_CONFLICT');

    const full_name = process.env.SUPER_ADMIN_FULL_NAME?.trim() || 'Super Admin';
    const email = process.env.SUPER_ADMIN_EMAIL?.trim() || undefined;
    let user: UserDocument | null = null;
    let lockAcquired = false;
    try {
        await BootstrapLock.create({ _id: INITIAL_SUPER_ADMIN_LOCK, created_at: new Date() });
        lockAcquired = true;
        user = await User.create({
            full_name,
            phone,
            email,
            password_hash: await hashPassword(password),
            role: IUserRoleEnum.ADMIN,
            status: IUserStatusEnum.ACTIVE,
            is_phone_verified: true,
            is_email_verified: Boolean(email),
        }) as UserDocument;
        await Admin.create({
            user_id: user._id,
            display_name: full_name,
            permissions: Object.values(IAdminPermissionEnum),
            super_admin: true,
            is_active: true,
            created_by: null,
        });
    } catch (error) {
        if (user?._id) await User.deleteOne({ _id: user._id }).exec();
        if (lockAcquired) await BootstrapLock.deleteOne({ _id: INITIAL_SUPER_ADMIN_LOCK }).exec();
        if ((error as { code?: number }).code === 11000) {
            throw new SuperAdminBootstrapError('SUPER_ADMIN_BOOTSTRAP_CONFLICT');
        }
        throw error;
    }

    console.log('[Migration] Initial Super Admin created');
}
