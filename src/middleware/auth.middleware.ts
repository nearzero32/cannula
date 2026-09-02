import { verifyAccessToken } from '../constants/jwt';
import type { TokenPayload } from '../interfaces/context.interface';
import crypto from 'crypto';
import RedisClient from '../databases/redis';
import Elysia from 'elysia';

const ACCESS_SESSION_TTL = 60 * 15; // 15 minutes

/** Returns a scoped auth plugin — call per route group so public routes stay unprotected. */
export function AuthPlugin() {
    return new Elysia().derive({ as: 'scoped' }, async ({ headers, request, status }) => {
        const auth = headers.authorization;

        if (!auth || auth === 'null' || auth === 'undefined' || auth.length === 0) {
            return status(401, { error: true, message: 'Authorization is required' });
        }

        const bearer = verifyAccessToken(auth) as TokenPayload | null;

        if (!bearer) {
            return status(401, { error: true, message: 'Invalid token' });
        }

        const rawToken = auth.trim().toLowerCase().startsWith('bearer ') ? auth.trim().slice(7).trim() : auth.trim();
        const sessionState = await getSessionState(bearer._id, rawToken);

        if (!sessionState) {
            return status(401, { error: true, message: 'Session revoked' });
        }

        const path = new URL(request.url).pathname;
        const pinChangeAllowed = path.endsWith('/mobile/auth/pin/change-required') || path.endsWith('/mobile/auth/logout');
        if (sessionState === 'restricted' && !pinChangeAllowed) {
            return status(403, { error: true, message: 'يجب تغيير الرمز السري قبل المتابعة' });
        }

        return { phrase: { _id: bearer._id, role: bearer.role, mustChangePin: sessionState === 'restricted' } };
    });
}

export async function storeAccessSession(user_id: string, token: string, ttl = ACCESS_SESSION_TTL, restricted = false): Promise<void> {
    const key = buildAccessKey(user_id, token);
    await RedisClient.getInstance().set(key, restricted ? 'restricted' : '1', ttl);
}

export async function revokeAccessSession(user_id: string, token: string): Promise<void> {
    const key = buildAccessKey(user_id, token);
    await RedisClient.getInstance().del(key);
}

async function getSessionState(user_id: string, token: string): Promise<string | null> {
    try {
        const result = await RedisClient.getInstance().get(buildAccessKey(user_id, token));
        return result === '1' || result === 'restricted' ? result : null;
    } catch {
        return null;
    }
}

export async function revokeAllUserSessions(user_id: string): Promise<number> {
    const redis = RedisClient.getInstance();
    return (await redis.deleteByPattern(`access:${user_id}:*`)) +
        (await redis.deleteByPattern(`refresh:${user_id}:*`));
}

function buildAccessKey(user_id: string, token: string): string {
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    return `access:${user_id}:${hash}`;
}
