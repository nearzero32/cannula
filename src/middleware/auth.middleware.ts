import { verifyAccessToken } from '../constants/jwt';
import type { TokenPayload } from '../interfaces/context.interface';
import crypto from 'crypto';
import RedisClient from '../databases/redis';
import Elysia from 'elysia';

const ACCESS_SESSION_TTL = 60 * 15; // 15 minutes

/** Returns a scoped auth plugin — call per route group so public routes stay unprotected. */
export function AuthPlugin() {
    return new Elysia().derive({ as: 'scoped' }, async ({ headers, status }) => {
        const auth = headers.authorization;

        if (!auth || auth === 'null' || auth === 'undefined' || auth.length === 0) {
            return status(401, { error: true, message: 'Authorization is required' });
        }

        const bearer = verifyAccessToken(auth) as TokenPayload | null;

        if (!bearer) {
            return status(401, { error: true, message: 'Invalid token' });
        }

        const rawToken = auth.trim().toLowerCase().startsWith('bearer ') ? auth.trim().slice(7).trim() : auth.trim();
        const isValid = await isSessionActive(bearer._id, rawToken);

        if (!isValid) {
            return status(401, { error: true, message: 'Session revoked' });
        }

        return { phrase: { _id: bearer._id, role: bearer.role } };
    });
}

export async function storeAccessSession(user_id: string, token: string, ttl = ACCESS_SESSION_TTL): Promise<void> {
    const key = buildAccessKey(user_id, token);
    await RedisClient.getInstance().set(key, '1', ttl);
}

export async function revokeAccessSession(user_id: string, token: string): Promise<void> {
    const key = buildAccessKey(user_id, token);
    await RedisClient.getInstance().del(key);
}

async function isSessionActive(user_id: string, token: string): Promise<boolean> {
    try {
        const result = await RedisClient.getInstance().get(buildAccessKey(user_id, token));
        return result === '1';
    } catch {
        return false;
    }
}

function buildAccessKey(user_id: string, token: string): string {
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    return `access:${user_id}:${hash}`;
}
