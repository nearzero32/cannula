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
import { SESSION_TTL_SECONDS } from '../src/constants/session';
import { TokenAudienceEnum, verifyAccessToken, verifyRefreshToken } from '../src/constants/jwt';
import { IUserRoleEnum, IUserStatusEnum, type IUserRole } from '../src/interfaces/user.interface';

const redisTestUrl = process.env.REDIS_TEST_URL;
const describeWithRedis = redisTestUrl ? describe : describe.skip;
const patientId = '507f1f77bcf86cd799439101';
const dashboardId = '507f1f77bcf86cd799439102';
const secondPatientId = '507f1f77bcf86cd799439103';
const digest = (jti: string) => crypto.createHash('sha256').update(jti).digest('hex');
const query = <T>(value: T) => ({ select() { return this; }, lean() { return this; }, exec: async () => value });

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

    test('creation writes session, sorted index, current digest, and bounded TTLs', async () => {
        const pair = await sessionService.create(accounts[patientId], TokenAudienceEnum.MOBILE, { deviceName: 'Redis integration phone' });
        const raw = await client.get(sessionKeys.session(pair.sessionId));
        const state = JSON.parse(raw!) as SessionState;
        const refresh = verifyRefreshToken(pair.refreshToken, TokenAudienceEnum.MOBILE)!;
        expect(state).toMatchObject({ sid: pair.sessionId, userId: patientId, deviceName: 'Redis integration phone' });
        expect(await client.zRange(sessionKeys.userSessions(patientId), 0, -1)).toEqual([pair.sessionId]);
        expect(await client.get(sessionKeys.currentRefresh(digest(refresh.jti)))).toBe(pair.sessionId);
        for (const key of [sessionKeys.session(pair.sessionId), sessionKeys.currentRefresh(digest(refresh.jti)), sessionKeys.userSessions(patientId), sessionKeys.userSessionSequence(patientId)]) {
            const ttl = await client.ttl(key);
            expect(ttl).toBeGreaterThan(0);
            expect(ttl).toBeLessThanOrEqual(SESSION_TTL_SECONDS);
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
        ], [s1.sessionId, digest(r1.jti), patientId, IUserRoleEnum.PATIENT, TokenAudienceEnum.MOBILE, 'false', unusedDigest, 'auth:refresh:current:', new Date().toISOString()]);
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
});
