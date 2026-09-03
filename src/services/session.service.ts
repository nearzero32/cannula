import crypto from 'crypto';
import RedisClient from '../databases/redis';
import User from '../models/users.model';
import Patient from '../models/patients.model';
import Doctor from '../models/doctors.model';
import Nurse from '../models/nurse.model';
import Pharmacy from '../models/pharmacy.model';
import Admin from '../models/admins.model';
import { IUserRoleEnum, IUserStatusEnum, type IUserRole } from '../interfaces/user.interface';
import { IPatientStatusEnum } from '../interfaces/patient.interface';
import { IDoctorStatusEnum } from '../interfaces/doctor.interface';
import { INurseStatusEnum } from '../interfaces/nurse.interface';
import { IPharmacyStatusEnum } from '../interfaces/pharmacy.interface';
import { TokenAudienceEnum, type AccessTokenPayload, type TokenAudience, signAccessToken, signRefreshToken, verifyRefreshToken } from '../constants/jwt';
import { MAX_DASHBOARD_SESSIONS, MAX_PATIENT_SESSIONS, SESSION_TTL_SECONDS } from '../constants/session';
import { DomainError } from './domain-error';
import authEventService from './auth-event.service';
import { AuthEventTypeEnum } from '../interfaces/auth-flow.interface';

export interface SessionDevice { deviceId?: string; deviceName?: string; platform?: string }
export interface SessionState extends SessionDevice {
    sid: string;
    userId: string;
    role: IUserRole;
    audience: TokenAudience;
    restricted: boolean;
    currentRefreshDigest: string;
    createdAt: string;
    lastSeenAt: string;
    lastRefreshedAt: string;
    expiresAt: string;
}
interface EventContext extends SessionDevice { phone?: string; patientId?: string; ip?: string; actorType?: string; actorUserId?: string; reasonCode?: string }

const SESSION_PREFIX = 'auth:session:';
const USER_SESSIONS_PREFIX = 'auth:user:';
const CURRENT_REFRESH_PREFIX = 'auth:refresh:current:';
const USED_REFRESH_PREFIX = 'auth:refresh:used:';

export const sessionKeys = {
    session: (sid: string) => `${SESSION_PREFIX}${sid}`,
    userSessions: (userId: string) => `${USER_SESSIONS_PREFIX}${userId}:sessions`,
    userSessionSequence: (userId: string) => `${USER_SESSIONS_PREFIX}${userId}:sequence`,
    currentRefresh: (digest: string) => `${CURRENT_REFRESH_PREFIX}${digest}`,
    usedRefresh: (digest: string) => `${USED_REFRESH_PREFIX}${digest}`,
};

const CREATE_SESSION_SCRIPT = `
-- CREATE_SESSION
redis.call('SETEX', KEYS[1], tonumber(ARGV[3]), ARGV[2])
redis.call('SETEX', KEYS[2], tonumber(ARGV[3]), ARGV[1])
local sequence = redis.call('INCR', KEYS[4])
redis.call('ZADD', KEYS[3], sequence, ARGV[1])
redis.call('EXPIRE', KEYS[3], tonumber(ARGV[3]))
redis.call('EXPIRE', KEYS[4], tonumber(ARGV[3]))
local evicted = {}
while redis.call('ZCARD', KEYS[3]) > tonumber(ARGV[4]) do
  local oldest = redis.call('ZPOPMIN', KEYS[3], 1)
  if #oldest == 0 then break end
  local oldSid = oldest[1]
  local oldKey = ARGV[5] .. oldSid
  local oldRaw = redis.call('GET', oldKey)
  if oldRaw then
    local ok, oldState = pcall(cjson.decode, oldRaw)
    if ok and oldState.currentRefreshDigest then redis.call('DEL', ARGV[6] .. oldState.currentRefreshDigest) end
    redis.call('DEL', oldKey)
    table.insert(evicted, oldSid)
  end
end
return evicted
`;

const ROTATE_REFRESH_SCRIPT = `
-- ROTATE_REFRESH
local raw = redis.call('GET', KEYS[1])
local active = redis.call('GET', KEYS[2])
if not raw or not active then
  if redis.call('EXISTS', KEYS[3]) == 1 then
    if raw then
      local ok, state = pcall(cjson.decode, raw)
      if ok and state.currentRefreshDigest then redis.call('DEL', ARGV[8] .. state.currentRefreshDigest) end
    end
    redis.call('DEL', KEYS[1])
    redis.call('ZREM', KEYS[5], ARGV[1])
    return {2, raw or ''}
  end
  if active then redis.call('DEL', KEYS[2]) end
  return {0, ''}
end
local ok, state = pcall(cjson.decode, raw)
if not ok or active ~= ARGV[1] or state.currentRefreshDigest ~= ARGV[2] or
   state.userId ~= ARGV[3] or state.role ~= ARGV[4] or state.audience ~= ARGV[5] or
   tostring(state.restricted) ~= ARGV[6] then
  if ok and state.currentRefreshDigest then redis.call('DEL', ARGV[8] .. state.currentRefreshDigest) end
  redis.call('DEL', KEYS[1])
  redis.call('DEL', KEYS[2])
  redis.call('ZREM', KEYS[5], ARGV[1])
  return {3, raw}
end
local ttl = redis.call('TTL', KEYS[1])
if ttl <= 0 then return {0, ''} end
state.currentRefreshDigest = ARGV[7]
state.lastRefreshedAt = ARGV[9]
state.lastSeenAt = ARGV[9]
local nextRaw = cjson.encode(state)
redis.call('DEL', KEYS[2])
redis.call('SETEX', KEYS[3], ttl, ARGV[1])
redis.call('SETEX', KEYS[4], ttl, ARGV[1])
redis.call('SETEX', KEYS[1], ttl, nextRaw)
return {1, nextRaw, ttl}
`;

const REVOKE_SESSION_SCRIPT = `
-- REVOKE_SESSION
local raw = redis.call('GET', KEYS[1])
if not raw then redis.call('ZREM', KEYS[2], ARGV[1]); return 0 end
local ok, state = pcall(cjson.decode, raw)
if ok and state.currentRefreshDigest then redis.call('DEL', ARGV[2] .. state.currentRefreshDigest) end
redis.call('DEL', KEYS[1])
redis.call('ZREM', KEYS[2], ARGV[1])
return 1
`;

const REVOKE_ALL_SCRIPT = `
-- REVOKE_ALL
local sids = redis.call('ZRANGE', KEYS[1], 0, -1)
local revoked = 0
for _, sid in ipairs(sids) do
  local key = ARGV[1] .. sid
  local raw = redis.call('GET', key)
  if raw then
    local ok, state = pcall(cjson.decode, raw)
    if ok and state.currentRefreshDigest then redis.call('DEL', ARGV[2] .. state.currentRefreshDigest) end
    redis.call('DEL', key)
    revoked = revoked + 1
  end
end
redis.call('DEL', KEYS[1])
redis.call('DEL', KEYS[2])
return revoked
`;

const LIST_SESSIONS_SCRIPT = `
-- LIST_SESSIONS
local sids = redis.call('ZRANGE', KEYS[1], 0, -1)
local result = {}
for _, sid in ipairs(sids) do
  local raw = redis.call('GET', ARGV[1] .. sid)
  if raw then table.insert(result, raw) else redis.call('ZREM', KEYS[1], sid) end
end
return result
`;

/** Exported for real-Redis compatibility tests; application code uses SessionService methods. */
export const sessionLuaScripts = {
    create: CREATE_SESSION_SCRIPT,
    rotate: ROTATE_REFRESH_SCRIPT,
    revoke: REVOKE_SESSION_SCRIPT,
    revokeAll: REVOKE_ALL_SCRIPT,
    list: LIST_SESSIONS_SCRIPT,
} as const;

const digestJti = (jti: string) => crypto.createHash('sha256').update(jti).digest('hex');
export function audienceForRole(role: IUserRole): TokenAudience {
    return role === 'patient' ? TokenAudienceEnum.MOBILE : TokenAudienceEnum.DASHBOARD;
}
function parseState(raw: unknown): SessionState | null {
    if (typeof raw !== 'string' || !raw) return null;
    try {
        const state = JSON.parse(raw) as SessionState;
        return state && typeof state.sid === 'string' && typeof state.userId === 'string' && typeof state.role === 'string' &&
            typeof state.audience === 'string' && typeof state.currentRefreshDigest === 'string' &&
            typeof state.restricted === 'boolean' && typeof state.expiresAt === 'string' ? state : null;
    } catch { return null; }
}
async function record(type: keyof typeof AuthEventTypeEnum, userId: string, sid: string, context: EventContext = {}) {
    try {
        await authEventService.record({
            type: AuthEventTypeEnum[type], success: true, user_id: userId, phone: context.phone,
            patient_id: context.patientId, reason_code: context.reasonCode, ip_address: context.ip,
            device_id: context.deviceId, device_name: context.deviceName, platform: context.platform,
            actor_type: context.actorType, actor_user_id: context.actorUserId, metadata: { sid },
        });
    } catch {}
}

async function hasActiveRoleProfile(userId: string, role: IUserRole): Promise<boolean> {
    switch (role) {
        case IUserRoleEnum.PATIENT:
            return Boolean(await Patient.findOne({ user_id: userId, status: IPatientStatusEnum.ACTIVE }).select('_id').lean().exec());
        case IUserRoleEnum.DOCTOR:
            return Boolean(await Doctor.findOne({ user_id: userId, status: IDoctorStatusEnum.ACTIVE }).select('_id').lean().exec());
        case IUserRoleEnum.NURSE:
            return Boolean(await Nurse.findOne({ user_id: userId, status: INurseStatusEnum.ACTIVE }).select('_id').lean().exec());
        case IUserRoleEnum.PHARMACY:
            return Boolean(await Pharmacy.findOne({ user_id: userId, status: IPharmacyStatusEnum.ACTIVE }).select('_id').lean().exec());
        case IUserRoleEnum.ADMIN:
            return Boolean(await Admin.findOne({ user_id: userId, is_active: true }).select('_id').lean().exec());
    }
}

export class SessionService {
    async create(user: { _id: unknown; role: IUserRole; must_change_pin?: boolean; phone?: string }, audience: TokenAudience, device: SessionDevice = {}, ip?: string) {
        if (audienceForRole(user.role) !== audience) throw new DomainError('نوع الجلسة غير صالح', 401, 'AUTH_WRONG_AUDIENCE');
        const userId = String(user._id), sid = crypto.randomUUID(), jti = crypto.randomUUID();
        const nowDate = new Date(), expiresAt = new Date(nowDate.getTime() + SESSION_TTL_SECONDS * 1000);
        const now = nowDate.toISOString(), restricted = user.must_change_pin === true, currentRefreshDigest = digestJti(jti);
        const state: SessionState = { sid, userId, role: user.role, audience, restricted, currentRefreshDigest, createdAt: now, lastSeenAt: now, lastRefreshedAt: now, expiresAt: expiresAt.toISOString(), ...device };
        const limit = user.role === 'patient' ? MAX_PATIENT_SESSIONS : MAX_DASHBOARD_SESSIONS;
        let evicted: unknown;
        try {
            evicted = await RedisClient.getInstance().eval(CREATE_SESSION_SCRIPT,
                [sessionKeys.session(sid), sessionKeys.currentRefresh(currentRefreshDigest), sessionKeys.userSessions(userId), sessionKeys.userSessionSequence(userId)],
                [sid, JSON.stringify(state), String(SESSION_TTL_SECONDS), String(limit), SESSION_PREFIX, CURRENT_REFRESH_PREFIX]);
        } catch { throw new DomainError('تعذر إنشاء الجلسة', 503, 'SESSION_STORE_UNAVAILABLE'); }
        const accessToken = signAccessToken({ _id: userId, role: user.role, sid, audience, restricted });
        const refreshToken = signRefreshToken({ _id: userId, role: user.role, sid, jti, audience, restricted });
        await record('SESSION_CREATED', userId, sid, { ...device, phone: user.phone, ip });
        for (const oldSid of Array.isArray(evicted) ? evicted : []) await record('SESSION_LIMIT_REVOKED', userId, String(oldSid), { reasonCode: 'OLDEST_SESSION_EVICTED' });
        return { accessToken, refreshToken, mustChangePin: restricted, sessionId: sid };
    }

    async get(userId: string, sid: string): Promise<SessionState | null> {
        try {
            const state = parseState(await RedisClient.getInstance().get(sessionKeys.session(sid)));
            return state?.userId === userId ? state : null;
        } catch { throw new DomainError('تعذر التحقق من الجلسة', 503, 'SESSION_STORE_UNAVAILABLE'); }
    }

    async validateAccess(payload: AccessTokenPayload): Promise<SessionState | null> {
        try {
            const state = parseState(await RedisClient.getInstance().get(sessionKeys.session(payload.sid)));
            return state && state.userId === payload._id && state.role === payload.role && state.audience === payload.aud &&
                state.restricted === payload.restricted ? state : null;
        } catch { return null; }
    }

    async refresh(token: string, audience: TokenAudience, context: { ip?: string } = {}) {
        const payload = verifyRefreshToken(token, audience);
        if (!payload) throw new DomainError('رمز التحديث غير صالح', 401, 'AUTH_REFRESH_INVALID');
        if (audienceForRole(payload.role) !== audience) throw new DomainError('رمز التحديث غير صالح لهذه الواجهة', 401, 'AUTH_WRONG_AUDIENCE');
        const oldDigest = digestJti(payload.jti), newJti = crypto.randomUUID(), newDigest = digestJti(newJti), now = new Date().toISOString();
        let rawResult: unknown;
        try {
            rawResult = await RedisClient.getInstance().eval(ROTATE_REFRESH_SCRIPT,
                [sessionKeys.session(payload.sid), sessionKeys.currentRefresh(oldDigest), sessionKeys.usedRefresh(oldDigest), sessionKeys.currentRefresh(newDigest), sessionKeys.userSessions(payload._id)],
                [payload.sid, oldDigest, payload._id, payload.role, audience, String(payload.restricted), newDigest, CURRENT_REFRESH_PREFIX, now]);
        } catch { throw new DomainError('تعذر تحديث الجلسة', 503, 'SESSION_STORE_UNAVAILABLE'); }
        const result = Array.isArray(rawResult) ? rawResult : [], code = Number(result[0]);
        if (code === 2) {
            await record('REFRESH_TOKEN_REUSE_DETECTED', payload._id, payload.sid, { ip: context.ip, reasonCode: 'CONSUMED_REFRESH_REUSED' });
            await record('SESSION_REVOKED', payload._id, payload.sid, { ip: context.ip, reasonCode: 'REFRESH_REUSE_DETECTED' });
            throw new DomainError('تم اكتشاف إعادة استخدام رمز التحديث', 401, 'AUTH_REFRESH_REUSED');
        }
        if (code === 3) throw new DomainError('بيانات جلسة التحديث غير متطابقة', 401, 'AUTH_REFRESH_INVALID');
        if (code !== 1) throw new DomainError('تم إلغاء أو انتهاء جلسة التحديث', 401, 'AUTH_SESSION_REVOKED');
        const state = parseState(result[1]), ttl = Number(result[2]);
        if (!state || !Number.isFinite(ttl) || ttl <= 0) {
            await this.revoke(payload._id, payload.sid, { reasonCode: 'INVALID_SESSION_STATE' });
            throw new DomainError('تم إلغاء جلسة التحديث', 401, 'AUTH_SESSION_REVOKED');
        }
        let user: any, profileActive: boolean;
        try {
            [user, profileActive] = await Promise.all([
                User.findById(payload._id).exec(),
                hasActiveRoleProfile(payload._id, payload.role),
            ]);
        }
        catch {
            await this.revoke(payload._id, payload.sid, { reasonCode: 'ACCOUNT_REVALIDATION_FAILED' });
            throw new DomainError('تعذر التحقق من الحساب', 503, 'ACCOUNT_REVALIDATION_UNAVAILABLE');
        }
        if (!user || !profileActive || user.status !== IUserStatusEnum.ACTIVE || user.role !== payload.role || audienceForRole(user.role) !== audience ||
            Boolean(user.must_change_pin) !== state.restricted) {
            await this.revoke(payload._id, payload.sid, { reasonCode: 'ACCOUNT_SECURITY_STATE_CHANGED' });
            throw new DomainError('الحساب غير موجود أو غير مفعّل', 401, 'REFRESH_ACCOUNT_INVALID');
        }
        const accessToken = signAccessToken({ _id: payload._id, role: payload.role, sid: payload.sid, audience, restricted: state.restricted });
        const refreshToken = signRefreshToken({ _id: payload._id, role: payload.role, sid: payload.sid, jti: newJti, audience, restricted: state.restricted, expiresIn: ttl });
        await record('SESSION_REFRESHED', payload._id, payload.sid, { deviceId: state.deviceId, deviceName: state.deviceName, platform: state.platform, ip: context.ip });
        return { accessToken, refreshToken, mustChangePin: state.restricted, sessionId: payload.sid };
    }

    async revoke(userId: string, sid: string, context: EventContext = {}): Promise<number> {
        let revoked: number;
        try {
            revoked = Number(await RedisClient.getInstance().eval(REVOKE_SESSION_SCRIPT,
                [sessionKeys.session(sid), sessionKeys.userSessions(userId)], [sid, CURRENT_REFRESH_PREFIX]));
        } catch { throw new DomainError('تعذر إلغاء الجلسة', 503, 'SESSION_STORE_UNAVAILABLE'); }
        if (revoked) await record('SESSION_REVOKED', userId, sid, context);
        return revoked;
    }

    async revokeAll(userId: string, context: EventContext = {}): Promise<number> {
        let revoked: number;
        try {
            revoked = Number(await RedisClient.getInstance().eval(REVOKE_ALL_SCRIPT,
                [sessionKeys.userSessions(userId), sessionKeys.userSessionSequence(userId)], [SESSION_PREFIX, CURRENT_REFRESH_PREFIX]));
        } catch { throw new DomainError('تعذر إلغاء الجلسات', 503, 'SESSION_STORE_UNAVAILABLE'); }
        await record('ALL_SESSIONS_REVOKED', userId, 'all', context);
        return revoked;
    }

    async list(userId: string): Promise<Omit<SessionState, 'currentRefreshDigest' | 'userId'>[]> {
        let raw: unknown;
        try { raw = await RedisClient.getInstance().eval(LIST_SESSIONS_SCRIPT, [sessionKeys.userSessions(userId)], [SESSION_PREFIX]); }
        catch { throw new DomainError('تعذر جلب الجلسات', 503, 'SESSION_STORE_UNAVAILABLE'); }
        return (Array.isArray(raw) ? raw : []).map(parseState).filter((state): state is SessionState => Boolean(state && state.userId === userId)).map(({ currentRefreshDigest: _digest, userId: _userId, ...safe }) => safe);
    }

    async count(userId: string): Promise<number> { return (await this.list(userId)).length; }
}
export default new SessionService();
