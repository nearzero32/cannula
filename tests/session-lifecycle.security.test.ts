import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import RedisClient from '../src/databases/redis';
import User from '../src/models/users.model';
import Patient from '../src/models/patients.model';
import authEventService from '../src/services/auth-event.service';
import sessionService, { type SessionState } from '../src/services/session.service';
import { DomainError } from '../src/services/domain-error';
import {
    TokenAudienceEnum,
    verifyAccessToken,
    verifyRefreshToken,
} from '../src/constants/jwt';
import { IUserRoleEnum, IUserStatusEnum, type IUserRole } from '../src/interfaces/user.interface';
import { mobileAuthController } from '../src/controller/mobile/auth.controller';
import { authController as dashboardAuthController } from '../src/controller/dash/auth.controller';
import patientAuthService from '../src/services/patient-auth.service';

class MemoryRedis {
    readonly values = new Map<string, string>();
    failReads = false;

    async get(key: string) {
        if (this.failReads) throw new Error('redis unavailable');
        return this.values.get(key) ?? null;
    }
    async set(key: string, value: string) { this.values.set(key, value); }
    async del(key: string) { return this.values.delete(key) ? 1 : 0; }
    async deleteByPattern(pattern: string) {
        const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
        let count = 0;
        for (const key of [...this.values.keys()]) if (key.startsWith(prefix)) { this.values.delete(key); count++; }
        return count;
    }
    async countByPattern(pattern: string) {
        const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
        return [...this.values.keys()].filter((key) => key.startsWith(prefix)).length;
    }
    async eval(_script: string, keys: string[], args: string[]) {
        const raw = this.values.get(keys[0]);
        if (!raw) return this.values.has(keys[1]) ? 2 : 0;
        const state = JSON.parse(raw) as SessionState;
        if (state.currentRefreshHash !== args[0]) {
            if (this.values.has(keys[1])) { this.values.delete(keys[0]); return 2; }
            return 0;
        }
        this.values.set(keys[1], '1');
        this.values.set(keys[0], args[1]);
        return 1;
    }
}

const query = <T>(value: T) => ({ exec: async () => value });
const patientId = '507f1f77bcf86cd799439011';
const dashboardId = '507f1f77bcf86cd799439012';

function account(_id: string, role: IUserRole, options: { status?: string; restricted?: boolean } = {}) {
    return {
        _id,
        role,
        status: options.status ?? IUserStatusEnum.ACTIVE,
        must_change_pin: options.restricted ?? false,
        phone: role === IUserRoleEnum.PATIENT ? '07700000000' : '07800000000',
    };
}

let redis: MemoryRedis;
let currentUsers: Record<string, any>;
let events: any[];

beforeEach(() => {
    process.env.ACCESS_TOKEN_SECRET = 'phase-three-access-token-secret-for-tests';
    process.env.REFRESH_TOKEN_SECRET = 'phase-three-refresh-token-secret-for-tests';
    redis = new MemoryRedis();
    currentUsers = {
        [patientId]: account(patientId, IUserRoleEnum.PATIENT),
        [dashboardId]: account(dashboardId, IUserRoleEnum.ADMIN),
    };
    events = [];
    spyOn(RedisClient, 'getInstance').mockReturnValue(redis as never);
    spyOn(User, 'findById').mockImplementation(((id: unknown) => query(currentUsers[String(id)] ?? null)) as never);
    spyOn(authEventService, 'record').mockImplementation(async (event: any) => { events.push(event); return event; });
});

afterEach(() => mock.restore());

describe('logical session token isolation', () => {
    test('access and refresh tokens are typed and cannot substitute for one another', async () => {
        const pair = await sessionService.create(currentUsers[patientId], TokenAudienceEnum.MOBILE);
        expect(verifyRefreshToken(pair.accessToken, TokenAudienceEnum.MOBILE)).toBeNull();
        expect(verifyAccessToken(pair.refreshToken, TokenAudienceEnum.MOBILE)).toBeNull();
        expect(verifyAccessToken(pair.accessToken, TokenAudienceEnum.MOBILE)?.tokenType).toBe('access');
        expect(verifyRefreshToken(pair.refreshToken, TokenAudienceEnum.MOBILE)?.tokenType).toBe('refresh');
    });

    test('mobile and dashboard refresh audiences are strictly isolated', async () => {
        const mobile = await sessionService.create(currentUsers[patientId], TokenAudienceEnum.MOBILE);
        const dashboard = await sessionService.create(currentUsers[dashboardId], TokenAudienceEnum.DASHBOARD);
        await expect(sessionService.refresh(mobile.refreshToken, TokenAudienceEnum.DASHBOARD)).rejects.toMatchObject({ code: 'REFRESH_INVALID', status: 401 });
        await expect(sessionService.refresh(dashboard.refreshToken, TokenAudienceEnum.MOBILE)).rejects.toMatchObject({ code: 'REFRESH_INVALID', status: 401 });
        await expect(sessionService.refresh(mobile.refreshToken, TokenAudienceEnum.MOBILE)).resolves.toMatchObject({ mustChangePin: false, sessionId: mobile.sessionId });
        await expect(sessionService.refresh(dashboard.refreshToken, TokenAudienceEnum.DASHBOARD)).resolves.toMatchObject({ mustChangePin: false, sessionId: dashboard.sessionId });
    });
});

describe('surface refresh endpoints', () => {
    const postRefresh = (controller: { handle(request: Request): Response | Promise<Response> }, refreshToken: string) => controller.handle(new Request('http://localhost/auth/refresh', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken }),
    }));

    test('Mobile and Dashboard endpoints accept only their own session families', async () => {
        const mobileOk = await sessionService.create(currentUsers[patientId], TokenAudienceEnum.MOBILE);
        const dashboardOk = await sessionService.create(currentUsers[dashboardId], TokenAudienceEnum.DASHBOARD);
        const mobileResponse = await postRefresh(mobileAuthController, mobileOk.refreshToken);
        const dashboardResponse = await postRefresh(dashboardAuthController, dashboardOk.refreshToken);
        expect(mobileResponse.status).toBe(200);
        expect(dashboardResponse.status).toBe(200);
        expect((await mobileResponse.json() as any).data).toMatchObject({ mustChangePin: false, sessionId: mobileOk.sessionId });
        expect((await dashboardResponse.json() as any).data).toMatchObject({ mustChangePin: false, sessionId: dashboardOk.sessionId });

        const mobileWrong = await sessionService.create(currentUsers[patientId], TokenAudienceEnum.MOBILE);
        const dashboardWrong = await sessionService.create(currentUsers[dashboardId], TokenAudienceEnum.DASHBOARD);
        expect((await postRefresh(dashboardAuthController, mobileWrong.refreshToken)).status).toBe(401);
        expect((await postRefresh(mobileAuthController, dashboardWrong.refreshToken)).status).toBe(401);
    });
});

describe('atomic refresh rotation and reuse handling', () => {
    test('rotation returns a new pair, immediately consumes the old token, and the replacement rotates again', async () => {
        const first = await sessionService.create(currentUsers[patientId], TokenAudienceEnum.MOBILE);
        const second = await sessionService.refresh(first.refreshToken, TokenAudienceEnum.MOBILE);
        expect(second.accessToken).not.toBe(first.accessToken);
        expect(second.refreshToken).not.toBe(first.refreshToken);
        expect(await sessionService.validateAccess(verifyAccessToken(second.accessToken, TokenAudienceEnum.MOBILE)!)).not.toBeNull();
        const third = await sessionService.refresh(second.refreshToken, TokenAudienceEnum.MOBILE);
        expect(third.refreshToken).not.toBe(second.refreshToken);
        await expect(sessionService.refresh(first.refreshToken, TokenAudienceEnum.MOBILE)).rejects.toMatchObject({ code: 'REFRESH_REUSE_DETECTED' });
    });

    test('two concurrent uses of one refresh token yield exactly one success', async () => {
        const pair = await sessionService.create(currentUsers[patientId], TokenAudienceEnum.MOBILE);
        const results = await Promise.allSettled([
            sessionService.refresh(pair.refreshToken, TokenAudienceEnum.MOBILE),
            sessionService.refresh(pair.refreshToken, TokenAudienceEnum.MOBILE),
        ]);
        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    });

    test('reuse revokes only the compromised family and records no token material', async () => {
        const compromised = await sessionService.create(currentUsers[patientId], TokenAudienceEnum.MOBILE, { deviceId: 'phone-a' });
        const other = await sessionService.create(currentUsers[patientId], TokenAudienceEnum.MOBILE, { deviceId: 'phone-b' });
        const rotated = await sessionService.refresh(compromised.refreshToken, TokenAudienceEnum.MOBILE);
        await expect(sessionService.refresh(compromised.refreshToken, TokenAudienceEnum.MOBILE)).rejects.toMatchObject({ code: 'REFRESH_REUSE_DETECTED' });
        expect(await sessionService.validateAccess(verifyAccessToken(rotated.accessToken, TokenAudienceEnum.MOBILE)!)).toBeNull();
        await expect(sessionService.refresh(rotated.refreshToken, TokenAudienceEnum.MOBILE)).rejects.toMatchObject({ code: 'REFRESH_REVOKED' });
        expect(await sessionService.validateAccess(verifyAccessToken(other.accessToken, TokenAudienceEnum.MOBILE)!)).not.toBeNull();
        await expect(sessionService.refresh(other.refreshToken, TokenAudienceEnum.MOBILE)).resolves.toBeTruthy();
        const reuse = events.find((event) => event.type === 'REFRESH_TOKEN_REUSE_DETECTED');
        expect(reuse).toBeTruthy();
        expect(JSON.stringify(reuse)).not.toContain(compromised.accessToken);
        expect(JSON.stringify(reuse)).not.toContain(compromised.refreshToken);
        expect(reuse.metadata).toEqual({ sessionId: compromised.sessionId });
    });
});

describe('session revocation', () => {
    test('current logout kills access and refresh while another device remains active', async () => {
        const current = await sessionService.create(currentUsers[patientId], TokenAudienceEnum.MOBILE);
        const other = await sessionService.create(currentUsers[patientId], TokenAudienceEnum.MOBILE);
        await sessionService.revoke(patientId, current.sessionId, { reasonCode: 'USER_LOGOUT' });
        expect(await sessionService.validateAccess(verifyAccessToken(current.accessToken, TokenAudienceEnum.MOBILE)!)).toBeNull();
        await expect(sessionService.refresh(current.refreshToken, TokenAudienceEnum.MOBILE)).rejects.toMatchObject({ code: 'REFRESH_REVOKED' });
        expect(await sessionService.validateAccess(verifyAccessToken(other.accessToken, TokenAudienceEnum.MOBILE)!)).not.toBeNull();
        await expect(sessionService.refresh(other.refreshToken, TokenAudienceEnum.MOBILE)).resolves.toBeTruthy();
    });

    test('logout-all kills every access and refresh token', async () => {
        const one = await sessionService.create(currentUsers[patientId], TokenAudienceEnum.MOBILE);
        const two = await sessionService.create(currentUsers[patientId], TokenAudienceEnum.MOBILE);
        expect(await sessionService.revokeAll(patientId, { reasonCode: 'USER_LOGOUT_ALL' })).toBe(2);
        for (const pair of [one, two]) {
            expect(await sessionService.validateAccess(verifyAccessToken(pair.accessToken, TokenAudienceEnum.MOBILE)!)).toBeNull();
            await expect(sessionService.refresh(pair.refreshToken, TokenAudienceEnum.MOBILE)).rejects.toMatchObject({ code: 'REFRESH_REVOKED' });
        }
        expect(events.some((event) => event.type === 'ALL_SESSIONS_REVOKED')).toBe(true);
    });

    test('Admin Patient revocation kills every family and none can refresh back', async () => {
        const one = await sessionService.create(currentUsers[patientId], TokenAudienceEnum.MOBILE);
        const two = await sessionService.create(currentUsers[patientId], TokenAudienceEnum.MOBILE);
        const patientProfileId = '507f1f77bcf86cd799439099';
        spyOn(Patient, 'findById').mockReturnValue(query({ _id: patientProfileId, user_id: patientId }) as never);
        expect(await patientAuthService.revokePatientSessions(patientProfileId, dashboardId, 'security response')).toEqual({ revoked: 2 });
        for (const pair of [one, two]) {
            expect(await sessionService.validateAccess(verifyAccessToken(pair.accessToken, TokenAudienceEnum.MOBILE)!)).toBeNull();
            await expect(sessionService.refresh(pair.refreshToken, TokenAudienceEnum.MOBILE)).rejects.toMatchObject({ code: 'REFRESH_REVOKED' });
        }
    });

    test('Admin PIN reset kills all old Patient sessions before temporary login', async () => {
        const old = await sessionService.create(currentUsers[patientId], TokenAudienceEnum.MOBILE);
        const patientProfileId = '507f1f77bcf86cd799439098';
        spyOn(Patient, 'findById').mockReturnValue(query({ _id: patientProfileId, user_id: patientId }) as never);
        spyOn(User, 'findOneAndUpdate').mockImplementation((() => {
            currentUsers[patientId].must_change_pin = true;
            return query(currentUsers[patientId]);
        }) as never);
        const reset = await patientAuthService.adminResetPin(patientProfileId, 'credential recovery', dashboardId);
        expect(reset.temporaryPin).toMatch(/^\d{6}$/);
        expect(reset.mustChangePin).toBe(true);
        expect(await sessionService.validateAccess(verifyAccessToken(old.accessToken, TokenAudienceEnum.MOBILE)!)).toBeNull();
        await expect(sessionService.refresh(old.refreshToken, TokenAudienceEnum.MOBILE)).rejects.toMatchObject({ code: 'REFRESH_REVOKED' });
    });
});

describe('restricted sessions and refresh-time account validation', () => {
    test('restricted refresh stays restricted, and replacement normal session cannot revive old family', async () => {
        currentUsers[patientId].must_change_pin = true;
        const restricted = await sessionService.create(currentUsers[patientId], TokenAudienceEnum.MOBILE);
        const refreshed = await sessionService.refresh(restricted.refreshToken, TokenAudienceEnum.MOBILE);
        expect(restricted.mustChangePin).toBe(true);
        expect(refreshed.mustChangePin).toBe(true);
        expect((await sessionService.validateAccess(verifyAccessToken(refreshed.accessToken, TokenAudienceEnum.MOBILE)!))?.restricted).toBe(true);
        await sessionService.revokeAll(patientId, { reasonCode: 'PIN_CHANGED' });
        currentUsers[patientId].must_change_pin = false;
        const normal = await sessionService.create(currentUsers[patientId], TokenAudienceEnum.MOBILE);
        expect(normal.mustChangePin).toBe(false);
        expect(await sessionService.validateAccess(verifyAccessToken(refreshed.accessToken, TokenAudienceEnum.MOBILE)!)).toBeNull();
        await expect(sessionService.refresh(refreshed.refreshToken, TokenAudienceEnum.MOBILE)).rejects.toMatchObject({ code: 'REFRESH_REVOKED' });
        expect(await sessionService.validateAccess(verifyAccessToken(normal.accessToken, TokenAudienceEnum.MOBILE)!)).not.toBeNull();
    });

    test('deleted, inactive, and role-mismatched users cannot refresh and their family is revoked', async () => {
        for (const state of ['deleted', 'inactive', 'role'] as const) {
            currentUsers[patientId] = account(patientId, IUserRoleEnum.PATIENT);
            const pair = await sessionService.create(currentUsers[patientId], TokenAudienceEnum.MOBILE);
            if (state === 'deleted') delete currentUsers[patientId];
            if (state === 'inactive') currentUsers[patientId].status = IUserStatusEnum.INACTIVE;
            if (state === 'role') currentUsers[patientId].role = IUserRoleEnum.DOCTOR;
            await expect(sessionService.refresh(pair.refreshToken, TokenAudienceEnum.MOBILE)).rejects.toMatchObject({ code: 'REFRESH_ACCOUNT_INVALID', status: 401 });
            expect(await sessionService.validateAccess(verifyAccessToken(pair.accessToken, TokenAudienceEnum.MOBILE)!)).toBeNull();
        }
    });
});

describe('session storage and failure safety', () => {
    test('Redis stores logical state and one-way JTI hashes, never plaintext tokens', async () => {
        const pair = await sessionService.create(currentUsers[patientId], TokenAudienceEnum.MOBILE, { deviceId: 'device', deviceName: 'Pixel', platform: 'android' });
        const rotated = await sessionService.refresh(pair.refreshToken, TokenAudienceEnum.MOBILE);
        const storage = JSON.stringify([...redis.values.entries()]);
        expect(storage).not.toContain(pair.accessToken);
        expect(storage).not.toContain(pair.refreshToken);
        expect(storage).not.toContain(rotated.accessToken);
        expect(storage).not.toContain(rotated.refreshToken);
        expect([...redis.values.keys()].some((key) => key.startsWith(`session:${patientId}:${pair.sessionId}`))).toBe(true);
        expect([...redis.values.keys()].some((key) => key.startsWith(`refresh-used:${patientId}:${pair.sessionId}:`))).toBe(true);
        const state = JSON.parse(redis.values.get(`session:${patientId}:${pair.sessionId}`)!) as SessionState;
        expect(state).toMatchObject({ deviceId: 'device', deviceName: 'Pixel', platform: 'android' });
    });

    test('Redis read failure fails closed for access and returns safe 503 for refresh', async () => {
        const pair = await sessionService.create(currentUsers[patientId], TokenAudienceEnum.MOBILE);
        redis.failReads = true;
        expect(await sessionService.validateAccess(verifyAccessToken(pair.accessToken, TokenAudienceEnum.MOBILE)!)).toBeNull();
        try {
            await sessionService.refresh(pair.refreshToken, TokenAudienceEnum.MOBILE);
            throw new Error('expected refresh failure');
        } catch (error) {
            expect(error).toBeInstanceOf(DomainError);
            expect(error).toMatchObject({ status: 503, code: 'SESSION_STORE_UNAVAILABLE' });
            expect(String((error as Error).message).toLowerCase()).not.toContain('redis');
        }
    });
});
