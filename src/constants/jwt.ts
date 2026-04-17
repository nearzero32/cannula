import jwt from 'jsonwebtoken';
import type { IUserRole } from '../interfaces/user.interface';

export interface AccessTokenPayload {
    _id: string;
    role: IUserRole;
}

export interface RefreshTokenPayload {
    _id: string;
}

export function signAccessToken(data: { _id: string; role: IUserRole }): string {
    return jwt.sign(data, process.env.ACCESS_TOKEN_SECRET!, { expiresIn: '15m' });
}

export function signRefreshToken(data: { _id: string }): string {
    return jwt.sign(data, process.env.REFRESH_TOKEN_SECRET!, { expiresIn: '7d' });
}

export function verifyAccessToken(tokenOrHeader?: string): AccessTokenPayload | null {
    let token = (tokenOrHeader ?? '').trim();
    if (token.toLowerCase().startsWith('bearer ')) token = token.slice(7).trim();
    if (!token) return null;
    try {
        return jwt.verify(token, process.env.ACCESS_TOKEN_SECRET!) as AccessTokenPayload;
    } catch {
        return null;
    }
}

export function verifyRefreshToken(token: string): RefreshTokenPayload | null {
    try {
        return jwt.verify(token, process.env.REFRESH_TOKEN_SECRET!) as RefreshTokenPayload;
    } catch {
        return null;
    }
}

export const verifyTokenInJwt = verifyAccessToken;
