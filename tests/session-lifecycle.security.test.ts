import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import jwt from 'jsonwebtoken';
import RedisClient from '../src/databases/redis';
import User from '../src/models/users.model';
import Patient from '../src/models/patients.model';
import Doctor from '../src/models/doctors.model';
import Nurse from '../src/models/nurse.model';
import Pharmacy from '../src/models/pharmacy.model';
import Admin from '../src/models/admins.model';
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
    readonly sortedSets = new Map<string, Map<string, number>>();
    readonly sequences = new Map<string, number>();
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
        if (this.failReads) throw new Error('redis unavailable');
        if (_script.includes('-- CREATE_SESSION')) {
            this.values.set(keys[0], args[1]);
            this.values.set(keys[1], args[0]);
            const index = this.sortedSets.get(keys[2]) ?? new Map<string, number>();
            const sequence = (this.sequences.get(keys[3]) ?? 0) + 1; this.sequences.set(keys[3], sequence);
            index.set(args[0], sequence); this.sortedSets.set(keys[2], index);
            const evicted: string[] = [];
            while (index.size > Number(args[3])) {
                const oldest = [...index.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))[0][0];
                index.delete(oldest);
                const oldKey = `${args[4]}${oldest}`, raw = this.values.get(oldKey);
                if (raw) {
                    const old = JSON.parse(raw) as SessionState;
                    this.values.delete(`${args[5]}${old.currentRefreshDigest}`);
                    this.values.delete(oldKey); evicted.push(oldest);
                }
            }
            return evicted;
        }
        if (_script.includes('-- ROTATE_REFRESH')) {
            const raw = this.values.get(keys[0]), active = this.values.get(keys[1]);
            if (!raw || !active) {
                if (this.values.has(keys[2])) {
                    if (raw) this.values.delete(`${args[7]}${(JSON.parse(raw) as SessionState).currentRefreshDigest}`);
                    this.values.delete(keys[0]); this.sortedSets.get(keys[4])?.delete(args[0]); return [2, raw ?? ''];
                }
                if (active) this.values.delete(keys[1]);
                return [0, ''];
            }
            const state = JSON.parse(raw) as SessionState;
            if (active !== args[0] || state.currentRefreshDigest !== args[1] || state.userId !== args[2] || state.role !== args[3] || state.audience !== args[4] || String(state.restricted) !== args[5]) {
                this.values.delete(`${args[7]}${state.currentRefreshDigest}`); this.values.delete(keys[0]); this.values.delete(keys[1]); this.sortedSets.get(keys[4])?.delete(args[0]); return [3, raw];
            }
            state.currentRefreshDigest = args[6]; state.lastRefreshedAt = args[8]; state.lastSeenAt = args[8];
            const next = JSON.stringify(state);
            this.values.delete(keys[1]); this.values.set(keys[2], args[0]); this.values.set(keys[3], args[0]); this.values.set(keys[0], next);
            return [1, next, 604800];
        }
        if (_script.includes('-- REVOKE_SESSION')) {
            const raw = this.values.get(keys[0]);
            this.sortedSets.get(keys[1])?.delete(args[0]);
            if (!raw) return 0;
            this.values.delete(`${args[1]}${(JSON.parse(raw) as SessionState).currentRefreshDigest}`); this.values.delete(keys[0]); return 1;
        }
        if (_script.includes('-- REVOKE_ALL')) {
            let revoked = 0;
            for (const sid of this.sortedSets.get(keys[0])?.keys() ?? []) {
                const key = `${args[0]}${sid}`, raw = this.values.get(key);
                if (raw) { this.values.delete(`${args[1]}${(JSON.parse(raw) as SessionState).currentRefreshDigest}`); this.values.delete(key); revoked++; }
            }
            this.sortedSets.delete(keys[0]); this.sequences.delete(keys[1]); return revoked;
        }
        if (_script.includes('-- LIST_SESSIONS')) {
            const index = this.sortedSets.get(keys[0]), result: string[] = [];
            for (const sid of [...(index?.keys() ?? [])]) {
                const raw = this.values.get(`${args[0]}${sid}`);
                if (raw) result.push(raw); else index?.delete(sid);
            }
            return result;
        }
        throw new Error('unknown script');
    }
}

const query = <T>(value: T) => ({ select() { return this; }, lean() { return this; }, exec: async () => value });
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
let inactiveProfiles: Set<string>;

beforeEach(() => {
    process.env.ACCESS_TOKEN_SECRET = 'phase-three-access-token-secret-for-tests';
    process.env.REFRESH_TOKEN_SECRET = 'phase-three-refresh-token-secret-for-tests';
    redis = new MemoryRedis();
    currentUsers = {
        [patientId]: account(patientId, IUserRoleEnum.PATIENT),
        [dashboardId]: account(dashboardId, IUserRoleEnum.ADMIN),
    };
    events = [];
    inactiveProfiles = new Set();
    spyOn(RedisClient, 'getInstance').mockReturnValue(redis as never);
    spyOn(User, 'findById').mockImplementation(((id: unknown) => query(currentUsers[String(id)] ?? null)) as never);
    const profileQuery = (filter: any) => query(inactiveProfiles.has(String(filter.user_id)) ? null : { _id: filter.user_id });
    spyOn(Patient, 'findOne').mockImplementation(profileQuery as never);
    spyOn(Doctor, 'findOne').mockImplementation(profileQuery as never);
    spyOn(Nurse, 'findOne').mockImplementation(profileQuery as never);
    spyOn(Pharmacy, 'findOne').mockImplementation(profileQuery as never);
    spyOn(Admin, 'findOne').mockImplementation(profileQuery as never);
    spyOn(authEventService, 'record').mockImplementation(async (event: any) => { events.push(event); return event; });
});

afterEach(() => mock.restore());

describe('logical session token isolation', () => {
    test('access and refresh tokens are typed and cannot substitute for one another', async () => {
        const pair = await sessionService.create(currentUsers[patientId], TokenAudienceEnum.MOBILE);
        expect(verifyRefreshToken(pair.accessToken, TokenAudienceEnum.MOBILE)).toBeNull();
        expect(verifyAccessToken(pair.refreshToken, TokenAudienceEnum.MOBILE)).toBeNull();
        const access = verifyAccessToken(pair.accessToken, TokenAudienceEnum.MOBILE)!;
        const refresh = verifyRefreshToken(pair.refreshToken, TokenAudienceEnum.MOBILE)!;
        expect(access).toMatchObject({ tokenType: 'access', sid: pair.sessionId, restricted: false, aud: TokenAudienceEnum.MOBILE });
        expect(refresh).toMatchObject({ tokenType: 'refresh', sid: pair.sessionId, restricted: false, aud: TokenAudienceEnum.MOBILE });
        expect(access.jti).not.toBe(refresh.jti);

        const untyped = jwt.sign({ _id: patientId, role: IUserRoleEnum.PATIENT, sid: pair.sessionId, restricted: false }, process.env.ACCESS_TOKEN_SECRET!, {
            audience: TokenAudienceEnum.MOBILE, subject: patientId, jwtid: '12345678-1234-4234-8234-123456789012', expiresIn: 900,
        });
        expect(verifyAccessToken(untyped, TokenAudienceEnum.MOBILE)).toBeNull();
    });

    test('mobile and dashboard refresh audiences are strictly isolated', async () => {
        const mobile = await sessionService.create(currentUsers[patientId], TokenAudienceEnum.MOBILE);
        const dashboard = await sessionService.create(currentUsers[dashboardId], TokenAudienceEnum.DASHBOARD);
        await expect(sessionService.refresh(mobile.refreshToken, TokenAudienceEnum.DASHBOARD)).rejects.toMatchObject({ code: 'AUTH_REFRESH_INVALID', status: 401 });
        await expect(sessionService.refresh(dashboard.refreshToken, TokenAudienceEnum.MOBILE)).rejects.toMatchObject({ code: 'AUTH_REFRESH_INVALID', status: 401 });
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
        await expect(sessionService.refresh(first.refreshToken, TokenAudienceEnum.MOBILE)).rejects.toMatchObject({ code: 'AUTH_REFRESH_REUSED' });
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
        await expect(sessionService.refresh(compromised.refreshToken, TokenAudienceEnum.MOBILE)).rejects.toMatchObject({ code: 'AUTH_REFRESH_REUSED' });
        expect(await sessionService.validateAccess(verifyAccessToken(rotated.accessToken, TokenAudienceEnum.MOBILE)!)).toBeNull();
        await expect(sessionService.refresh(rotated.refreshToken, TokenAudienceEnum.MOBILE)).rejects.toMatchObject({ code: 'AUTH_SESSION_REVOKED' });
        expect(await sessionService.validateAccess(verifyAccessToken(other.accessToken, TokenAudienceEnum.MOBILE)!)).not.toBeNull();
        await expect(sessionService.refresh(other.refreshToken, TokenAudienceEnum.MOBILE)).resolves.toBeTruthy();
        const reuse = events.find((event) => event.type === 'REFRESH_TOKEN_REUSE_DETECTED');
        expect(reuse).toBeTruthy();
        expect(JSON.stringify(reuse)).not.toContain(compromised.accessToken);
        expect(JSON.stringify(reuse)).not.toContain(compromised.refreshToken);
        expect(reuse.metadata).toEqual({ sid: compromised.sessionId });
    });
});

describe('session revocation', () => {
    test('current logout kills access and refresh while another device remains active', async () => {
        const current = await sessionService.create(currentUsers[patientId], TokenAudienceEnum.MOBILE);
        const other = await sessionService.create(currentUsers[patientId], TokenAudienceEnum.MOBILE);
        await sessionService.revoke(patientId, current.sessionId, { reasonCode: 'USER_LOGOUT' });
        expect(await sessionService.validateAccess(verifyAccessToken(current.accessToken, TokenAudienceEnum.MOBILE)!)).toBeNull();
        await expect(sessionService.refresh(current.refreshToken, TokenAudienceEnum.MOBILE)).rejects.toMatchObject({ code: 'AUTH_SESSION_REVOKED' });
        expect(await sessionService.validateAccess(verifyAccessToken(other.accessToken, TokenAudienceEnum.MOBILE)!)).not.toBeNull();
        await expect(sessionService.refresh(other.refreshToken, TokenAudienceEnum.MOBILE)).resolves.toBeTruthy();
    });

    test('logout-all kills every access and refresh token', async () => {
        const one = await sessionService.create(currentUsers[patientId], TokenAudienceEnum.MOBILE);
        const two = await sessionService.create(currentUsers[patientId], TokenAudienceEnum.MOBILE);
        expect(await sessionService.revokeAll(patientId, { reasonCode: 'USER_LOGOUT_ALL' })).toBe(2);
        for (const pair of [one, two]) {
            expect(await sessionService.validateAccess(verifyAccessToken(pair.accessToken, TokenAudienceEnum.MOBILE)!)).toBeNull();
            await expect(sessionService.refresh(pair.refreshToken, TokenAudienceEnum.MOBILE)).rejects.toMatchObject({ code: 'AUTH_SESSION_REVOKED' });
        }
        expect(events.some((event) => event.type === 'ALL_SESSIONS_REVOKED')).toBe(true);
    });

    test('Admin Patient revocation kills every family and none can refresh back', async () => {
        const one = await sessionService.create(currentUsers[patientId], TokenAudienceEnum.MOBILE);
        const two = await sessionService.create(currentUsers[patientId], TokenAudienceEnum.MOBILE);
        const patientProfileId = '507f1f77bcf86cd799439099';
        spyOn(Patient, 'findById').mockReturnValue(query({ _id: patientProfileId, user_id: patientId }) as never);
        expect(await patientAuthService.revokePatientSessions(patientProfileId, dashboardId, 'security response')).toEqual({ revokedSessionsCount: 2 });
        for (const pair of [one, two]) {
            expect(await sessionService.validateAccess(verifyAccessToken(pair.accessToken, TokenAudienceEnum.MOBILE)!)).toBeNull();
            await expect(sessionService.refresh(pair.refreshToken, TokenAudienceEnum.MOBILE)).rejects.toMatchObject({ code: 'AUTH_SESSION_REVOKED' });
        }
    });

    test('Admin PIN reset kills all old Patient sessions before temporary login', async () => {
        const old = await sessionService.create(currentUsers[patientId], TokenAudienceEnum.MOBILE);
        const patientProfileId = '507f1f77bcf86cd799439098';
        spyOn(Patient, 'findById').mockReturnValue(query({ _id: patientProfileId, user_id: patientId }) as never);
        spyOn(User, 'findOne').mockReturnValue(query(currentUsers[patientId]) as never);
        spyOn(User, 'findOneAndUpdate').mockImplementation((() => {
            currentUsers[patientId].must_change_pin = true;
            return query(currentUsers[patientId]);
        }) as never);
        const reset = await patientAuthService.adminResetPin(patientProfileId, 'credential recovery', dashboardId);
        expect(reset.temporaryPin).toMatch(/^\d{6}$/);
        expect(reset.mustChangePin).toBe(true);
        expect(await sessionService.validateAccess(verifyAccessToken(old.accessToken, TokenAudienceEnum.MOBILE)!)).toBeNull();
        await expect(sessionService.refresh(old.refreshToken, TokenAudienceEnum.MOBILE)).rejects.toMatchObject({ code: 'AUTH_SESSION_REVOKED' });
    });
});

describe('session indexes, listing, and limits', () => {
    test('Patient sixth login evicts only the oldest of five sessions', async () => {
        const pairs: Awaited<ReturnType<typeof sessionService.create>>[] = [];
        for (let index = 0; index < 6; index++) pairs.push(await sessionService.create(currentUsers[patientId], TokenAudienceEnum.MOBILE, { deviceId: `patient-${index}` }));
        expect(await sessionService.count(patientId)).toBe(5);
        expect(await sessionService.validateAccess(verifyAccessToken(pairs[0].accessToken, TokenAudienceEnum.MOBILE)!)).toBeNull();
        expect(await sessionService.validateAccess(verifyAccessToken(pairs[5].accessToken, TokenAudienceEnum.MOBILE)!)).not.toBeNull();
        expect(events.some(event => event.type === 'SESSION_LIMIT_REVOKED' && event.metadata.sid === pairs[0].sessionId)).toBe(true);
    });

    test('Dashboard fourth login evicts the oldest of three sessions and does not affect another user', async () => {
        const otherId = '507f1f77bcf86cd799439013';
        currentUsers[otherId] = account(otherId, IUserRoleEnum.DOCTOR);
        const unrelated = await sessionService.create(currentUsers[otherId], TokenAudienceEnum.DASHBOARD);
        const pairs: Awaited<ReturnType<typeof sessionService.create>>[] = [];
        for (let index = 0; index < 4; index++) pairs.push(await sessionService.create(currentUsers[dashboardId], TokenAudienceEnum.DASHBOARD));
        expect(await sessionService.count(dashboardId)).toBe(3);
        expect(await sessionService.validateAccess(verifyAccessToken(pairs[0].accessToken, TokenAudienceEnum.DASHBOARD)!)).toBeNull();
        expect(await sessionService.validateAccess(verifyAccessToken(unrelated.accessToken, TokenAudienceEnum.DASHBOARD)!)).not.toBeNull();
    });

    test('listing cleans stale index members and never returns refresh material', async () => {
        const pair = await sessionService.create(currentUsers[patientId], TokenAudienceEnum.MOBILE, { deviceName: 'Pixel' });
        redis.sortedSets.get(`auth:user:${patientId}:sessions`)!.set('stale-sid', 0);
        const listed = await sessionService.list(patientId);
        expect(listed).toHaveLength(1);
        expect(listed[0]).toMatchObject({ sid: pair.sessionId, deviceName: 'Pixel' });
        expect(listed[0]).not.toHaveProperty('currentRefreshDigest');
        expect(redis.sortedSets.get(`auth:user:${patientId}:sessions`)!.has('stale-sid')).toBe(false);
    });
});

describe('restricted sessions and refresh-time account validation', () => {
    test('restricted refresh stays restricted, and replacement normal session cannot revive old family', async () => {
        currentUsers[patientId].must_change_pin = true;
        const restricted = await sessionService.create(currentUsers[patientId], TokenAudienceEnum.MOBILE);
        const refreshed = await sessionService.refresh(restricted.refreshToken, TokenAudienceEnum.MOBILE);
        expect(restricted.mustChangePin).toBe(true);
        expect(refreshed.mustChangePin).toBe(true);
        expect(verifyRefreshToken(refreshed.refreshToken, TokenAudienceEnum.MOBILE)?.restricted).toBe(true);
        expect((await sessionService.validateAccess(verifyAccessToken(refreshed.accessToken, TokenAudienceEnum.MOBILE)!))?.restricted).toBe(true);
        await sessionService.revokeAll(patientId, { reasonCode: 'PIN_CHANGED' });
        currentUsers[patientId].must_change_pin = false;
        const normal = await sessionService.create(currentUsers[patientId], TokenAudienceEnum.MOBILE);
        expect(normal.mustChangePin).toBe(false);
        expect(await sessionService.validateAccess(verifyAccessToken(refreshed.accessToken, TokenAudienceEnum.MOBILE)!)).toBeNull();
        await expect(sessionService.refresh(refreshed.refreshToken, TokenAudienceEnum.MOBILE)).rejects.toMatchObject({ code: 'AUTH_SESSION_REVOKED' });
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

    test('an out-of-band role-profile disable is caught during refresh revalidation', async () => {
        const pair = await sessionService.create(currentUsers[patientId], TokenAudienceEnum.MOBILE);
        inactiveProfiles.add(patientId);
        await expect(sessionService.refresh(pair.refreshToken, TokenAudienceEnum.MOBILE)).rejects.toMatchObject({ code: 'REFRESH_ACCOUNT_INVALID', status: 401 });
        expect(await sessionService.validateAccess(verifyAccessToken(pair.accessToken, TokenAudienceEnum.MOBILE)!)).toBeNull();
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
        expect(redis.values.has(`auth:session:${pair.sessionId}`)).toBe(true);
        expect([...redis.values.keys()].some((key) => key.startsWith('auth:refresh:used:'))).toBe(true);
        const state = JSON.parse(redis.values.get(`auth:session:${pair.sessionId}`)!) as SessionState;
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
        await expect(sessionService.revoke(patientId, pair.sessionId)).rejects.toMatchObject({ status: 503, code: 'SESSION_STORE_UNAVAILABLE' });
    });

    test('Mongo revalidation failure consumes the refresh and revokes the family without issuing tokens', async () => {
        const pair = await sessionService.create(currentUsers[patientId], TokenAudienceEnum.MOBILE);
        spyOn(User, 'findById').mockImplementation((() => ({ exec: async () => { throw new Error('mongo unavailable'); } })) as never);
        await expect(sessionService.refresh(pair.refreshToken, TokenAudienceEnum.MOBILE)).rejects.toMatchObject({ status: 503, code: 'ACCOUNT_REVALIDATION_UNAVAILABLE' });
        expect(await sessionService.validateAccess(verifyAccessToken(pair.accessToken, TokenAudienceEnum.MOBILE)!)).toBeNull();
        await expect(sessionService.refresh(pair.refreshToken, TokenAudienceEnum.MOBILE)).rejects.toMatchObject({ code: 'AUTH_REFRESH_REUSED' });
    });
});
