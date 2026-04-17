import { verifyAccessToken } from '../constants/jwt';
import type { TokenPayload } from '../interfaces/context.interface';
import crypto from 'crypto';
import RedisClient from '../databases/redis';
import Elysia from 'elysia';

const ACCESS_SESSION_TTL = 60 * 15; // 15 minutes

export const AuthPlugin = new Elysia({ name: 'auth-plugin' }).derive({ as: 'global' }, async ({ headers, status }) => {
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

export async function storeAccessSession(userId: string, token: string, ttl = ACCESS_SESSION_TTL): Promise<void> {
    const key = buildAccessKey(userId, token);
    await RedisClient.getInstance().set(key, '1', ttl);
}

export async function revokeAccessSession(userId: string, token: string): Promise<void> {
    const key = buildAccessKey(userId, token);
    await RedisClient.getInstance().del(key);
}

async function isSessionActive(userId: string, token: string): Promise<boolean> {
    try {
        const result = await RedisClient.getInstance().get(buildAccessKey(userId, token));
        return result === '1';
    } catch {
        return false;
    }
}

function buildAccessKey(userId: string, token: string): string {
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    return `access:${userId}:${hash}`;
}
