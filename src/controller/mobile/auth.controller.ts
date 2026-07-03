import Elysia, { t } from 'elysia';
import crypto from 'crypto';
import mongoose from 'mongoose';
import User from '../../models/users.model';
import { generateSHA512 } from '../../constants/hashing';
import { signAccessToken, signRefreshToken } from '../../constants/jwt';
import { storeAccessSession } from '../../middleware/auth.middleware';
import userService from '../../services/user.service';
import patientService from '../../services/patient.service';
import ActivityLogService from '../../services/activity-log.service';
import { IUserRoleEnum, IUserStatusEnum } from '../../interfaces/user.interface';
import { IPatientStatusEnum } from '../../interfaces/patient.interface';
import { IActivityLogActionEnum, IActivityLogSourceEnum } from '../../interfaces/activity-log.interface';
import RedisClient from '../../databases/redis';

const ACCESS_TTL = 60 * 15;
const REFRESH_TTL = 60 * 60 * 24 * 7;

function buildRefreshKey(user_id: string, token: string): string {
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    return `refresh:${user_id}:${hash}`;
}

async function storeRefreshSession(user_id: string, token: string): Promise<void> {
    await RedisClient.getInstance().set(buildRefreshKey(user_id, token), '1', REFRESH_TTL);
}

const registerBodySchema = t.Object({
    full_name: t.String({ minLength: 2, maxLength: 120 }),
    phone: t.String({ minLength: 1 }),
    password: t.String({ minLength: 6 }),
    email: t.Optional(t.Nullable(t.String())),
});

export const mobileAuthController = new Elysia({ prefix: '/auth' })

    .post(
        '/register',
        async ({ body, set }) => {
            const existingUser = await userService.findByPhone(body.phone);
            if (existingUser) {
                set.status = 409;
                return { error: true, message: 'رقم الهاتف مسجل مسبقاً' };
            }

            let user_id: string | undefined;

            try {
                const user = await userService.create(
                    {
                        full_name: body.full_name,
                        phone: body.phone,
                        email: body.email ?? undefined,
                        password_hash: generateSHA512(body.password),
                        password_show: body.password,
                        role: IUserRoleEnum.PATIENT,
                        status: IUserStatusEnum.ACTIVE,
                        is_phone_verified: false,
                        is_email_verified: false,
                    },
                    {
                        endpoint: '/mobile/auth/register',
                        source: IActivityLogSourceEnum.MOBILE,
                    }
                );

                user_id = (user._id as mongoose.Types.ObjectId).toString();

                const patient = await patientService.create(
                    {
                        user_id: user._id as mongoose.Types.ObjectId,
                        full_name: body.full_name,
                        phone: body.phone,
                        status: IPatientStatusEnum.ACTIVE,
                    },
                    {
                        user_id,
                        user_name: IUserRoleEnum.PATIENT + '_' + user_id,
                        user_type: IUserRoleEnum.PATIENT,
                        endpoint: '/mobile/auth/register',
                        source: IActivityLogSourceEnum.MOBILE,
                    }
                );

                const accessToken = signAccessToken({ _id: user_id, role: IUserRoleEnum.PATIENT });
                const refreshToken = signRefreshToken({ _id: user_id });

                await Promise.all([
                    storeAccessSession(user_id, accessToken, ACCESS_TTL),
                    storeRefreshSession(user_id, refreshToken),
                ]);

                try {
                    await ActivityLogService.logActivity({
                        user_id,
                        user_name: IUserRoleEnum.PATIENT + '_' + user_id,
                        user_type: IUserRoleEnum.PATIENT,
                        method: 'POST',
                        endpoint: '/mobile/auth/register',
                        action: IActivityLogActionEnum.OTHER,
                        collection_name: 'users',
                        document_id: user_id,
                        request_body: { phone: body.phone, full_name: body.full_name },
                        source: IActivityLogSourceEnum.MOBILE,
                    });
                } catch { }

                set.status = 201;
                return {
                    error: false,
                    message: 'تم إنشاء الحساب بنجاح',
                    data: {
                        accessToken,
                        refreshToken,
                        user: {
                            _id: user_id,
                            full_name: user.full_name,
                            phone: user.phone,
                            email: user.email,
                            role: user.role,
                            status: user.status,
                        },
                        patient: {
                            _id: (patient._id as mongoose.Types.ObjectId).toString(),
                            full_name: patient.full_name,
                            status: patient.status,
                            profile_completed: false,
                        },
                    },
                };
            } catch {
                if (user_id) {
                    await User.findByIdAndDelete(user_id);
                }
                set.status = 500;
                return { error: true, message: 'فشل إنشاء الحساب، يرجى المحاولة لاحقاً' };
            }
        },
        { body: registerBodySchema }
    );
