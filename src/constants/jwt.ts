import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import type { IUserRole } from '../interfaces/user.interface';
import { ACCESS_TOKEN_TTL_SECONDS, SESSION_TTL_SECONDS } from './session';

export const TokenAudienceEnum = { MOBILE: 'mobile', DASHBOARD: 'dashboard' } as const;
export type TokenAudience = (typeof TokenAudienceEnum)[keyof typeof TokenAudienceEnum];

interface TokenIdentity { _id: string; role: IUserRole; sid: string; aud: TokenAudience; sub: string; restricted: boolean }
export interface AccessTokenPayload extends TokenIdentity { tokenType: 'access'; jti: string }
export interface RefreshTokenPayload extends TokenIdentity { tokenType: 'refresh'; jti: string }

const roles = new Set<IUserRole>(['admin', 'doctor', 'nurse', 'pharmacy', 'patient']);
const validIdentity = (value: any, audience: TokenAudience) => Boolean(
    value && typeof value._id === 'string' && value.sub === value._id && typeof value.jti === 'string' && value.jti.length >= 20 &&
    typeof value.sid === 'string' && value.sid.length >= 20 && value.aud === audience && roles.has(value.role) &&
    typeof value.restricted === 'boolean'
);

export function signAccessToken(data: { _id: string; role: IUserRole; sid: string; audience: TokenAudience; restricted?: boolean }): string {
    return jwt.sign(
        { _id: data._id, role: data.role, sid: data.sid, tokenType: 'access', restricted: data.restricted === true },
        process.env.ACCESS_TOKEN_SECRET!,
        { expiresIn: ACCESS_TOKEN_TTL_SECONDS, audience: data.audience, subject: data._id, jwtid: crypto.randomUUID() }
    );
}

export function signRefreshToken(data: { _id: string; role: IUserRole; sid: string; jti: string; audience: TokenAudience; restricted?: boolean; expiresIn?: number }): string {
    return jwt.sign(
        { _id: data._id, role: data.role, sid: data.sid, tokenType: 'refresh', restricted: data.restricted === true },
        process.env.REFRESH_TOKEN_SECRET!,
        { expiresIn: data.expiresIn ?? SESSION_TTL_SECONDS, audience: data.audience, subject: data._id, jwtid: data.jti }
    );
}

export function verifyAccessToken(tokenOrHeader: string | undefined, audience: TokenAudience): AccessTokenPayload | null {
    let token = (tokenOrHeader ?? '').trim();
    if (token.toLowerCase().startsWith('bearer ')) token = token.slice(7).trim();
    if (!token) return null;
    try {
        const payload = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET!, { audience }) as AccessTokenPayload;
        return validIdentity(payload, audience) && payload.tokenType === 'access' ? payload : null;
    } catch { return null; }
}

export function verifyRefreshToken(token: string, audience: TokenAudience): RefreshTokenPayload | null {
    try {
        const payload = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET!, { audience }) as RefreshTokenPayload;
        return validIdentity(payload, audience) && payload.tokenType === 'refresh' && typeof payload.jti === 'string' && payload.jti.length >= 20 ? payload : null;
    } catch { return null; }
}
