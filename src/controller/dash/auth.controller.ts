import Elysia, { t } from 'elysia';
import crypto from 'crypto';
import { generateSHA512 } from '../../constants/hashing';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../constants/jwt';
import { AuthPlugin, storeAccessSession, revokeAccessSession } from '../../middleware/auth.middleware';
import userService from '../../services/user.service';
import { IUserRoleEnum } from '../../interfaces/user.interface';
import RedisClient from '../../databases/redis';

const DASHBOARD_ROLES = [IUserRoleEnum.ADMIN, IUserRoleEnum.DOCTOR];
const ACCESS_TTL = 60 * 15;       // 15 minutes
const REFRESH_TTL = 60 * 60 * 24 * 7; // 7 days

function buildRefreshKey(userId: string, token: string): string {
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    return `refresh:${userId}:${hash}`;
}

async function storeRefreshSession(userId: string, token: string): Promise<void> {
    await RedisClient.getInstance().set(buildRefreshKey(userId, token), '1', REFRESH_TTL);
}

async function revokeRefreshSession(userId: string, token: string): Promise<void> {
    await RedisClient.getInstance().del(buildRefreshKey(userId, token));
}

async function isRefreshSessionValid(userId: string, token: string): Promise<boolean> {
    const result = await RedisClient.getInstance().get(buildRefreshKey(userId, token));
    return result === '1';
}

export const authController = new Elysia({ prefix: '/auth' })

    .post(
        '/login',
        async ({ body, set }) => {
            const user = await userService.findByCredentials({
                phone: body.phone,
                passwordHash: generateSHA512(body.password),
                roles: DASHBOARD_ROLES,
            });

            if (!user) {
                set.status = 401;
                return { error: true, message: 'Invalid phone or password' };
            }

            if (user.status !== 'active') {
                set.status = 401;
                return { error: true, message: 'Account is not active' };
            }

            const userId = (user._id as any).toString();
            const accessToken = signAccessToken({ _id: userId, role: user.role });
            const refreshToken = signRefreshToken({ _id: userId });

            await Promise.all([
                storeAccessSession(userId, accessToken, ACCESS_TTL),
                storeRefreshSession(userId, refreshToken),
            ]);

            return {
                error: false,
                message: 'Login successful',
                data: {
                    accessToken,
                    refreshToken,
                    user: {
                        _id: userId,
                        fullName: user.fullName,
                        phone: user.phone,
                        role: user.role,
                        status: user.status,
                    },
                },
            };
        },
        {
            body: t.Object({
                phone: t.String({ minLength: 1 }),
                password: t.String({ minLength: 1 }),
            }),
        }
    )

    .post(
        '/refresh',
        async ({ body, set }) => {
            const payload = verifyRefreshToken(body.refreshToken);
            if (!payload) {
                set.status = 401;
                return { error: true, message: 'Invalid refresh token' };
            }

            const isValid = await isRefreshSessionValid(payload._id, body.refreshToken);
            if (!isValid) {
                set.status = 401;
                return { error: true, message: 'Refresh token revoked' };
            }

            const user = await userService.getById(payload._id);
            if (!user || user.status !== 'active') {
                set.status = 401;
                return { error: true, message: 'Account not found or inactive' };
            }

            // Rotate both tokens
            await revokeRefreshSession(payload._id, body.refreshToken);

            const accessToken = signAccessToken({ _id: payload._id, role: user.role });
            const refreshToken = signRefreshToken({ _id: payload._id });

            await Promise.all([
                storeAccessSession(payload._id, accessToken, ACCESS_TTL),
                storeRefreshSession(payload._id, refreshToken),
            ]);

            return {
                error: false,
                data: { accessToken, refreshToken },
            };
        },
        {
            body: t.Object({
                refreshToken: t.String({ minLength: 1 }),
            }),
        }
    )

    .group('', (app) =>
        app.use(AuthPlugin).post('/logout', async ({ phrase, headers }) => {
            const raw = headers.authorization ?? '';
            const token = raw.trim().toLowerCase().startsWith('bearer ') ? raw.trim().slice(7).trim() : raw.trim();
            await revokeAccessSession(phrase._id, token);
            return { error: false, message: 'Logged out successfully' };
        })
    );
