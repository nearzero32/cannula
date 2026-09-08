import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import crypto from 'crypto';
import type { RedisClientType } from 'redis';
import RedisClient from '../src/databases/redis';
import User from '../src/models/users.model';
import Patient from '../src/models/patients.model';
import Doctor from '../src/models/doctors.model';
import Nurse from '../src/models/nurse.model';
import Pharmacy from '../src/models/pharmacy.model';
import Admin from '../src/models/admins.model';
import authEventService from '../src/services/auth-event.service';
import sessionService, { sessionKeys, sessionLuaScripts, type SessionState } from '../src/services/session.service';
import { SESSION_TTL_SECONDS, USED_REFRESH_MARKER_TTL_SECONDS } from '../src/constants/session';
import { TokenAudienceEnum, verifyAccessToken, verifyRefreshToken } from '../src/constants/jwt';
import { IUserRoleEnum, IUserStatusEnum, type IUserRole } from '../src/interfaces/user.interface';

const redisTestUrl = process.env.REDIS_TEST_URL;
const describeWithRedis = redisTestUrl ? describe : describe.skip;
const patientId = '507f1f77bcf86cd799439101';
const dashboardId = '507f1f77bcf86cd799439102';
const secondPatientId = '507f1f77bcf86cd799439103';
const digest = (jti: string) => crypto.createHash('sha256').update(jti).digest('hex');
const query = <T>(value: T) => ({ select() { return this; }, lean() { return this; }, exec: async () => value });
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
    try { await promise; return null; } catch (error) { return error; }
}

function account(_id: string, role: IUserRole) {
    return { _id, role, status: IUserStatusEnum.ACTIVE, must_change_pin: false, phone: `077${_id.slice(-8)}` };
}
describeWithRedis('SessionService against isolated real Redis', () => {
    let client: RedisClientType;
    let accounts: Record<string, ReturnType<typeof account>>;
    let events: any[];

    beforeAll(async () => {
        const parsed = new URL(redisTestUrl!);
        if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname) || !parsed.port || parsed.port === '6379') {
            throw new Error('REDIS_TEST_URL must use loopback and an explicit non-default port');
        }
        const redis = RedisClient.getInstance();
        await redis.connect();
        client = redis.getClient();
        if (await client.ping() !== 'PONG') throw new Error('Isolated Redis did not respond to PING');
    });

    beforeEach(async () => {
        await client.flushDb();
        accounts = {
            [patientId]: account(patientId, IUserRoleEnum.PATIENT),
            [dashboardId]: account(dashboardId, IUserRoleEnum.ADMIN),
            [secondPatientId]: account(secondPatientId, IUserRoleEnum.PATIENT),
        };
        events = [];
        spyOn(User, 'findById').mockImplementation(((id: unknown) => query(accounts[String(id)] ?? null)) as never);
        const activeProfile = (filter: { user_id: unknown }) => query(accounts[String(filter.user_id)] ? { _id: filter.user_id } : null);
        spyOn(Patient, 'findOne').mockImplementation(activeProfile as never);
        spyOn(Doctor, 'findOne').mockImplementation(activeProfile as never);
        spyOn(Nurse, 'findOne').mockImplementation(activeProfile as never);
        spyOn(Pharmacy, 'findOne').mockImplementation(activeProfile as never);
        spyOn(Admin, 'findOne').mockImplementation(activeProfile as never);
        spyOn(authEventService, 'record').mockImplementation(async (event: any) => { events.push(event); return event; });
    });

    afterEach(() => mock.restore());
    afterAll(async () => {
        if (client?.isOpen) { await client.flushDb(); await RedisClient.getInstance().disconnect(); }
    });

    test('mobile creation writes persistent session, index, sequence, and current refresh keys', async () => {
        const pair = await sessionService.create(accounts[patientId], TokenAudienceEnum.MOBILE, { deviceName: 'Redis integration phone' });
        const raw = await client.get(sessionKeys.session(pair.sessionId));
        const state = JSON.parse(raw!) as SessionState;
        const refresh = verifyRefreshToken(pair.refreshToken, TokenAudienceEnum.MOBILE)!;
        expect(state).toMatchObject({ sid: pair.sessionId, userId: patientId, deviceName: 'Redis integration phone', persistent: true, expiresAt: null });
        expect(await client.zRange(sessionKeys.userSessions(patientId), 0, -1)).toEqual([pair.sessionId]);
        expect(await client.get(sessionKeys.currentRefresh(digest(refresh.jti)))).toBe(pair.sessionId);
        for (const key of [sessionKeys.session(pair.sessionId), sessionKeys.currentRefresh(digest(refresh.jti)), sessionKeys.userSessions(patientId), sessionKeys.userSessionSequence(patientId)]) {
            expect(await client.ttl(key)).toBe(-1);
        }
        expect((JSON.parse(Buffer.from(pair.refreshToken.split('.')[1], 'base64url').toString()) as { exp?: number }).exp).toBeUndefined();
        expect((JSON.parse(Buffer.from(pair.accessToken.split('.')[1], 'base64url').toString()) as { exp?: number }).exp).toBeNumber();
    });

    test('dashboard creation remains finite in Redis and in its refresh JWT', async () => {
        const pair = await sessionService.create(accounts[dashboardId], TokenAudienceEnum.DASHBOARD);
        const refresh = verifyRefreshToken(pair.refreshToken, TokenAudienceEnum.DASHBOARD)!;
        const state = JSON.parse((await client.get(sessionKeys.session(pair.sessionId)))!) as SessionState;
        expect(state.persistent).toBe(false);
        expect(state.expiresAt).toBeString();
        expect(refresh.exp).toBeNumber();
        for (const key of [sessionKeys.session(pair.sessionId), sessionKeys.currentRefresh(digest(refresh.jti)), sessionKeys.userSessions(dashboardId), sessionKeys.userSessionSequence(dashboardId)]) {
            expect(await client.ttl(key)).toBeGreaterThan(0);
            expect(await client.ttl(key)).toBeLessThanOrEqual(SESSION_TTL_SECONDS);
        }
    });

    test('rotation atomically consumes R1, installs its tombstone and R2, updates state, and preserves sid', async () => {
        const first = await sessionService.create(accounts[patientId], TokenAudienceEnum.MOBILE);
        const r1 = verifyRefreshToken(first.refreshToken, TokenAudienceEnum.MOBILE)!;
        const second = await sessionService.refresh(first.refreshToken, TokenAudienceEnum.MOBILE);
        const r2 = verifyRefreshToken(second.refreshToken, TokenAudienceEnum.MOBILE)!;
        const state = JSON.parse((await client.get(sessionKeys.session(first.sessionId)))!) as SessionState;
        expect(second.sessionId).toBe(first.sessionId);
        expect(await client.exists(sessionKeys.currentRefresh(digest(r1.jti)))).toBe(0);
        expect(await client.get(sessionKeys.usedRefresh(digest(r1.jti)))).toBe(first.sessionId);
        expect(await client.get(sessionKeys.currentRefresh(digest(r2.jti)))).toBe(first.sessionId);
        expect(state.currentRefreshDigest).toBe(digest(r2.jti));
        expect(await client.ttl(sessionKeys.usedRefresh(digest(r1.jti)))).toBeGreaterThan(0);
        expect(await client.ttl(sessionKeys.usedRefresh(digest(r1.jti)))).toBeLessThanOrEqual(USED_REFRESH_MARKER_TTL_SECONDS);
        expect(await client.ttl(sessionKeys.session(first.sessionId))).toBe(-1);
        expect(await client.ttl(sessionKeys.currentRefresh(digest(r2.jti)))).toBe(-1);
    });

    test('twenty mobile rotations never introduce an active-session or index TTL', async () => {
        let pair: Awaited<ReturnType<typeof sessionService.refresh>> = await sessionService.create(accounts[patientId], TokenAudienceEnum.MOBILE);
        for (let index = 0; index < 20; index++) {
            pair = await sessionService.refresh(pair.refreshToken, TokenAudienceEnum.MOBILE);
            const refresh = verifyRefreshToken(pair.refreshToken, TokenAudienceEnum.MOBILE)!;
            expect(await client.ttl(sessionKeys.session(pair.sessionId))).toBe(-1);
            expect(await client.ttl(sessionKeys.currentRefresh(digest(refresh.jti)))).toBe(-1);
            expect(await client.ttl(sessionKeys.userSessions(patientId))).toBe(-1);
            expect(await client.ttl(sessionKeys.userSessionSequence(patientId))).toBe(-1);
            expect(refresh.exp).toBeUndefined();
        }
    });

    test('ancient and multi-generation replay revokes the family after its used marker expires', async () => {
        const first = await sessionService.create(accounts[patientId], TokenAudienceEnum.MOBILE);
        const r1 = verifyRefreshToken(first.refreshToken, TokenAudienceEnum.MOBILE)!;
        const second = await sessionService.refresh(first.refreshToken, TokenAudienceEnum.MOBILE);
        const third = await sessionService.refresh(second.refreshToken, TokenAudienceEnum.MOBILE);
        const r3 = verifyRefreshToken(third.refreshToken, TokenAudienceEnum.MOBILE)!;
        await client.del(sessionKeys.usedRefresh(digest(r1.jti)));
        expect(await client.exists(sessionKeys.usedRefresh(digest(r1.jti)))).toBe(0);

        expect(await rejectionOf(sessionService.refresh(first.refreshToken, TokenAudienceEnum.MOBILE))).toMatchObject({ code: 'AUTH_REFRESH_REUSED' });
        expect(await client.exists(sessionKeys.session(first.sessionId))).toBe(0);
        expect(await client.exists(sessionKeys.currentRefresh(digest(r3.jti)))).toBe(0);
        expect(await client.zScore(sessionKeys.userSessions(patientId), first.sessionId)).toBeNull();
    });

    test('missing Redis state and missing current mapping fail closed without reconstructing trust', async () => {
        const lost = await sessionService.create(accounts[patientId], TokenAudienceEnum.MOBILE);
        await client.flushDb();
        expect(await rejectionOf(sessionService.refresh(lost.refreshToken, TokenAudienceEnum.MOBILE))).toMatchObject({ code: 'AUTH_SESSION_REVOKED' });
        expect(await client.dbSize()).toBe(0);

        const inconsistent = await sessionService.create(accounts[patientId], TokenAudienceEnum.MOBILE);
        const payload = verifyRefreshToken(inconsistent.refreshToken, TokenAudienceEnum.MOBILE)!;
        await client.del(sessionKeys.currentRefresh(digest(payload.jti)));
        expect(await rejectionOf(sessionService.refresh(inconsistent.refreshToken, TokenAudienceEnum.MOBILE))).toMatchObject({ code: 'AUTH_REFRESH_INVALID' });
        expect(await client.exists(sessionKeys.session(inconsistent.sessionId))).toBe(0);
    });

    test('parallel R1 refresh has exactly one success and leaves no second usable replacement', async () => {
        const first = await sessionService.create(accounts[patientId], TokenAudienceEnum.MOBILE);
        const results = await Promise.allSettled([
            sessionService.refresh(first.refreshToken, TokenAudienceEnum.MOBILE),
            sessionService.refresh(first.refreshToken, TokenAudienceEnum.MOBILE),
        ]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
        expect(await client.exists(sessionKeys.session(first.sessionId))).toBe(0);
        expect(await client.keys('auth:refresh:current:*')).toHaveLength(0);
        expect(events.some(event => event.type === 'REFRESH_TOKEN_REUSE_DETECTED')).toBe(true);
    });

    test('reusing R1 after R1 to R2 revokes S1 and R2 while independent S2 survives', async () => {
        const s1 = await sessionService.create(accounts[patientId], TokenAudienceEnum.MOBILE, { deviceId: 's1' });
        const s2 = await sessionService.create(accounts[patientId], TokenAudienceEnum.MOBILE, { deviceId: 's2' });
        const rotated = await sessionService.refresh(s1.refreshToken, TokenAudienceEnum.MOBILE);
        const r1 = verifyRefreshToken(s1.refreshToken, TokenAudienceEnum.MOBILE)!;
        const r2 = verifyRefreshToken(rotated.refreshToken, TokenAudienceEnum.MOBILE)!;
        const unusedDigest = digest(crypto.randomUUID());
        const reuseResult = await RedisClient.getInstance().eval(sessionLuaScripts.rotate, [
            sessionKeys.session(s1.sessionId), sessionKeys.currentRefresh(digest(r1.jti)), sessionKeys.usedRefresh(digest(r1.jti)),
            sessionKeys.currentRefresh(unusedDigest), sessionKeys.userSessions(patientId),
            sessionKeys.userSessionSequence(patientId),
        ], [s1.sessionId, digest(r1.jti), patientId, IUserRoleEnum.PATIENT, TokenAudienceEnum.MOBILE, 'false', unusedDigest, 'auth:refresh:current:', new Date().toISOString(), 'true', String(USED_REFRESH_MARKER_TTL_SECONDS)]);
        expect(reuseResult).toBeArray();
        expect((reuseResult as unknown[])[0]).toBe(2);
        expect(typeof (reuseResult as unknown[])[1]).toBe('string');
        expect(await client.exists(sessionKeys.session(s1.sessionId))).toBe(0);
        expect(await client.exists(sessionKeys.currentRefresh(digest(r2.jti)))).toBe(0);
        expect(await sessionService.validateAccess(verifyAccessToken(s2.accessToken, TokenAudienceEnum.MOBILE)!)).not.toBeNull();
        expect(await client.exists(sessionKeys.currentRefresh(digest(verifyRefreshToken(s2.refreshToken, TokenAudienceEnum.MOBILE)!.jti)))).toBe(1);
    });

    test('real Redis enforces Patient five and Dashboard three oldest-session limits', async () => {
        const patients = [];
        for (let index = 0; index < 6; index++) patients.push(await sessionService.create(accounts[patientId], TokenAudienceEnum.MOBILE));
        expect(await client.zCard(sessionKeys.userSessions(patientId))).toBe(5);
        expect(await client.exists(sessionKeys.session(patients[0].sessionId))).toBe(0);
        expect(await client.exists(sessionKeys.session(patients[5].sessionId))).toBe(1);

        const dashboards = [];
        for (let index = 0; index < 4; index++) dashboards.push(await sessionService.create(accounts[dashboardId], TokenAudienceEnum.DASHBOARD));
        expect(await client.zCard(sessionKeys.userSessions(dashboardId))).toBe(3);
        expect(await client.exists(sessionKeys.session(dashboards[0].sessionId))).toBe(0);
        expect(await client.exists(sessionKeys.session(dashboards[3].sessionId))).toBe(1);
    });

    test('single revoke and revoke-all remove sessions, indexes, and every current refresh without scans', async () => {
        expect(sessionLuaScripts.revokeAll).not.toMatch(/redis\.call\(['"](?:KEYS|SCAN)['"]/i);
        const one = await sessionService.create(accounts[patientId], TokenAudienceEnum.MOBILE);
        const two = await sessionService.create(accounts[patientId], TokenAudienceEnum.MOBILE);
        const oneRefresh = verifyRefreshToken(one.refreshToken, TokenAudienceEnum.MOBILE)!;
        expect(await sessionService.revoke(patientId, one.sessionId)).toBe(1);
        expect(await client.exists(sessionKeys.session(one.sessionId))).toBe(0);
        expect(await client.zScore(sessionKeys.userSessions(patientId), one.sessionId)).toBeNull();
        expect(await client.exists(sessionKeys.currentRefresh(digest(oneRefresh.jti)))).toBe(0);
        expect(await sessionService.revokeAll(patientId)).toBe(1);
        expect(await client.exists(sessionKeys.session(two.sessionId))).toBe(0);
        expect(await client.exists(sessionKeys.userSessions(patientId))).toBe(0);
        expect(await client.exists(sessionKeys.userSessionSequence(patientId))).toBe(0);
        expect(await client.keys('auth:refresh:current:*')).toHaveLength(0);
    });

    test('listing removes a manually inserted stale index member', async () => {
        const pair = await sessionService.create(accounts[secondPatientId], TokenAudienceEnum.MOBILE);
        await client.zAdd(sessionKeys.userSessions(secondPatientId), { score: 0, value: 'stale-sid' });
        const listed = await sessionService.list(secondPatientId);
        expect(listed.map(session => session.sid)).toEqual([pair.sessionId]);
        expect(await client.zScore(sessionKeys.userSessions(secondPatientId), 'stale-sid')).toBeNull();
    });

    test('successful refresh lazily upgrades a legacy finite mobile session but not a dashboard session', async () => {
        const mobile = await sessionService.create(accounts[patientId], TokenAudienceEnum.MOBILE);
        const mobileRefresh = verifyRefreshToken(mobile.refreshToken, TokenAudienceEnum.MOBILE)!;
        const mobileKey = sessionKeys.session(mobile.sessionId);
        const legacyMobile = JSON.parse((await client.get(mobileKey))!) as Partial<SessionState>;
        delete legacyMobile.persistent;
        legacyMobile.expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
        await client.setEx(mobileKey, SESSION_TTL_SECONDS, JSON.stringify(legacyMobile));
        await client.expire(sessionKeys.currentRefresh(digest(mobileRefresh.jti)), SESSION_TTL_SECONDS);
        await client.expire(sessionKeys.userSessions(patientId), SESSION_TTL_SECONDS);
        await client.expire(sessionKeys.userSessionSequence(patientId), SESSION_TTL_SECONDS);

        await sessionService.refresh(mobile.refreshToken, TokenAudienceEnum.MOBILE);
        const upgraded = JSON.parse((await client.get(mobileKey))!) as SessionState;
        expect(upgraded).toMatchObject({ persistent: true, expiresAt: null });
        expect(await client.ttl(mobileKey)).toBe(-1);
        expect(await client.ttl(sessionKeys.userSessions(patientId))).toBe(-1);
        expect(await client.ttl(sessionKeys.userSessionSequence(patientId))).toBe(-1);

        const dashboard = await sessionService.create(accounts[dashboardId], TokenAudienceEnum.DASHBOARD);
        const refreshed = await sessionService.refresh(dashboard.refreshToken, TokenAudienceEnum.DASHBOARD);
        const dashboardState = JSON.parse((await client.get(sessionKeys.session(dashboard.sessionId)))!) as SessionState;
        expect(dashboardState.persistent).toBe(false);
        expect(dashboardState.expiresAt).toBeString();
        expect(await client.ttl(sessionKeys.session(dashboard.sessionId))).toBeGreaterThan(0);
        expect(verifyRefreshToken(refreshed.refreshToken, TokenAudienceEnum.DASHBOARD)?.exp).toBeNumber();
    });

    test('failed and concurrent legacy refreshes never partially or multiply migrate state', async () => {
        const failed = await sessionService.create(accounts[patientId], TokenAudienceEnum.MOBILE);
        const failedPayload = verifyRefreshToken(failed.refreshToken, TokenAudienceEnum.MOBILE)!;
        const failedKey = sessionKeys.session(failed.sessionId);
        const failedLegacy = JSON.parse((await client.get(failedKey))!) as Partial<SessionState>;
        delete failedLegacy.persistent;
        failedLegacy.expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
        await client.setEx(failedKey, SESSION_TTL_SECONDS, JSON.stringify(failedLegacy));
        await client.del(sessionKeys.currentRefresh(digest(failedPayload.jti)));
        expect(await rejectionOf(sessionService.refresh(failed.refreshToken, TokenAudienceEnum.MOBILE))).toMatchObject({ code: 'AUTH_REFRESH_INVALID' });
        expect(await client.exists(failedKey)).toBe(0);

        const concurrent = await sessionService.create(accounts[secondPatientId], TokenAudienceEnum.MOBILE);
        const concurrentPayload = verifyRefreshToken(concurrent.refreshToken, TokenAudienceEnum.MOBILE)!;
        const concurrentKey = sessionKeys.session(concurrent.sessionId);
        const concurrentLegacy = JSON.parse((await client.get(concurrentKey))!) as Partial<SessionState>;
        delete concurrentLegacy.persistent;
        concurrentLegacy.expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
        await client.setEx(concurrentKey, SESSION_TTL_SECONDS, JSON.stringify(concurrentLegacy));
        await client.expire(sessionKeys.currentRefresh(digest(concurrentPayload.jti)), SESSION_TTL_SECONDS);
        const results = await Promise.allSettled([
            sessionService.refresh(concurrent.refreshToken, TokenAudienceEnum.MOBILE),
            sessionService.refresh(concurrent.refreshToken, TokenAudienceEnum.MOBILE),
        ]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
        expect(await client.keys('auth:refresh:current:*')).toHaveLength(0);
        expect(await client.exists(concurrentKey)).toBe(0);
    });
});
