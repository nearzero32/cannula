import User from '../models/users.model';
import Admin from '../models/admins.model';
import { generateSHA512 } from '../constants/hashing';
import { IAdminPermissionEnum } from '../interfaces/admin.interface';
import { IUserRoleEnum, IUserStatusEnum } from '../interfaces/user.interface';

const DEFAULT_SUPER_ADMIN_FULL_NAME = 'Super Admin';
const DEFAULT_SUPER_ADMIN_PHONE = '07000000000';
const DEFAULT_SUPER_ADMIN_PASSWORD = 'Admin@123456';

export async function ensureSuperAdminExists(): Promise<void> {
    const existingSuperAdmin = await Admin.findOne({ super_admin: true }).lean();
    if (existingSuperAdmin) return;

    const full_name = process.env.SUPER_ADMIN_FULL_NAME || DEFAULT_SUPER_ADMIN_FULL_NAME;
    const phone = process.env.SUPER_ADMIN_PHONE || DEFAULT_SUPER_ADMIN_PHONE;
    const password = process.env.SUPER_ADMIN_PASSWORD || DEFAULT_SUPER_ADMIN_PASSWORD;
    const email = process.env.SUPER_ADMIN_EMAIL || undefined;

    if (!process.env.SUPER_ADMIN_PHONE || !process.env.SUPER_ADMIN_PASSWORD) {
        console.warn(
            '[Migration] SUPER_ADMIN_PHONE / SUPER_ADMIN_PASSWORD are not set. Using default bootstrap credentials. Set env vars in production.'
        );
    }

    let user = await User.findOne({ phone });

    if (!user) {
        user = await User.create({
            full_name,
            phone,
            email,
            password_hash: generateSHA512(password),
            password_show: password,
            role: IUserRoleEnum.ADMIN,
            status: IUserStatusEnum.ACTIVE,
            is_phone_verified: true,
            is_email_verified: Boolean(email),
        });
    } else {
        user.full_name = full_name;
        user.role = IUserRoleEnum.ADMIN;
        user.status = IUserStatusEnum.ACTIVE;
        user.password_hash = generateSHA512(password);
        user.password_show = password;
        if (email !== undefined) user.email = email;
        user.is_phone_verified = true;
        if (email !== undefined) user.is_email_verified = true;
        await user.save();
    }

    await Admin.findOneAndUpdate(
        { user_id: user._id },
        {
            $set: {
                display_name: full_name,
                permissions: Object.values(IAdminPermissionEnum),
                super_admin: true,
                is_active: true,
            },
            $setOnInsert: {
                created_by: null,
            },
        },
        { upsert: true, returnDocument: 'after' }
    );

    console.log(`[Migration] Super admin ensured for phone: ${phone}`);
}
