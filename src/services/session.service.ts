import crypto from 'crypto';
import RedisClient from '../databases/redis';
import User from '../models/users.model';
import { IUserStatusEnum, type IUserRole } from '../interfaces/user.interface';
import { TokenAudienceEnum, type AccessTokenPayload, type TokenAudience, signAccessToken, signRefreshToken, verifyRefreshToken } from '../constants/jwt';
import { DomainError } from './domain-error';
import authEventService from './auth-event.service';
import { AuthEventTypeEnum } from '../interfaces/auth-flow.interface';

const SESSION_TTL = 60 * 60 * 24 * 7;
export interface SessionDevice { deviceId?: string; deviceName?: string; platform?: string }
export interface SessionState {
    userId: string; role: IUserRole; audience: TokenAudience; restricted: boolean;
    currentRefreshHash: string; createdAt: string; lastRefreshedAt: string;
    deviceId?: string; deviceName?: string; platform?: string;
}
interface EventContext extends SessionDevice { phone?: string; patientId?: string; ip?: string; actorType?: string; actorUserId?: string; reasonCode?: string }

const ROTATE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  if redis.call('EXISTS', KEYS[2]) == 1 then return 2 end
  return 0
end
local ok, state = pcall(cjson.decode, raw)
if not ok or state.currentRefreshHash ~= ARGV[1] then
  if redis.call('EXISTS', KEYS[2]) == 1 then
    redis.call('DEL', KEYS[1])
    return 2
  end
  return 0
end
redis.call('SETEX', KEYS[2], tonumber(ARGV[3]), '1')
redis.call('SETEX', KEYS[1], tonumber(ARGV[3]), ARGV[2])
return 1
`;

const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const sessionKey = (userId: string, sid: string) => `session:${userId}:${sid}`;
const usedRefreshKey = (userId: string, sid: string, jti: string) => `refresh-used:${userId}:${sid}:${hash(jti)}`;
export function audienceForRole(role: IUserRole): TokenAudience {
    return role === 'patient' ? TokenAudienceEnum.MOBILE : TokenAudienceEnum.DASHBOARD;
}
function parseState(raw: string | null): SessionState | null {
    if (!raw) return null;
    try {
        const state = JSON.parse(raw) as SessionState;
        return state && typeof state.userId === 'string' && typeof state.role === 'string' && typeof state.audience === 'string' &&
            typeof state.currentRefreshHash === 'string' && typeof state.restricted === 'boolean' ? state : null;
    } catch { return null; }
}
async function record(type: keyof typeof AuthEventTypeEnum, userId: string, sid: string, context: EventContext = {}) {
    try {
        await authEventService.record({
            type: AuthEventTypeEnum[type], success: true, user_id: userId, phone: context.phone,
            patient_id: context.patientId,
            reason_code: context.reasonCode, ip_address: context.ip,
            device_id: context.deviceId, device_name: context.deviceName, platform: context.platform,
            actor_type: context.actorType, actor_user_id: context.actorUserId, metadata: { sessionId: sid },
        });
    } catch {}
}

export class SessionService {
    async create(user: { _id: unknown; role: IUserRole; must_change_pin?: boolean; phone?: string }, audience: TokenAudience, device: SessionDevice = {}, ip?: string) {
        if (audienceForRole(user.role) !== audience) throw new DomainError('نوع الجلسة غير صالح', 401, 'SESSION_AUDIENCE_INVALID');
        const userId = String(user._id), sid = crypto.randomUUID(), jti = crypto.randomUUID(), now = new Date().toISOString();
        const restricted = user.must_change_pin === true;
        const state: SessionState = { userId, role: user.role, audience, restricted, currentRefreshHash: hash(jti), createdAt: now, lastRefreshedAt: now, ...device };
        const accessToken = signAccessToken({ _id: userId, role: user.role, sid, audience });
        const refreshToken = signRefreshToken({ _id: userId, role: user.role, sid, jti, audience });
        try { await RedisClient.getInstance().set(sessionKey(userId, sid), JSON.stringify(state), SESSION_TTL); }
        catch { throw new DomainError('تعذر إنشاء الجلسة', 503, 'SESSION_STORE_UNAVAILABLE'); }
        await record('SESSION_CREATED', userId, sid, { ...device, phone: user.phone, ip });
        return { accessToken, refreshToken, mustChangePin: restricted, sessionId: sid };
    }

    async validateAccess(payload: AccessTokenPayload): Promise<SessionState | null> {
        try {
            const state = parseState(await RedisClient.getInstance().get(sessionKey(payload._id, payload.sid)));
            return state && state.userId === payload._id && state.role === payload.role && state.audience === payload.aud ? state : null;
        } catch { return null; }
    }

    async refresh(token: string, audience: TokenAudience, context: { ip?: string } = {}) {
        const payload = verifyRefreshToken(token, audience);
        if (!payload || audienceForRole(payload.role) !== audience) throw new DomainError('رمز التحديث غير صالح', 401, 'REFRESH_INVALID');
        const key = sessionKey(payload._id, payload.sid);
        let state: SessionState | null;
        try { state = parseState(await RedisClient.getInstance().get(key)); }
        catch { throw new DomainError('تعذر التحقق من الجلسة', 503, 'SESSION_STORE_UNAVAILABLE'); }
        if (state && (state.userId !== payload._id || state.role !== payload.role || state.audience !== audience)) {
            await this.revoke(payload._id, payload.sid, { reasonCode: 'SESSION_CLAIM_MISMATCH' });
            throw new DomainError('رمز التحديث غير صالح', 401, 'REFRESH_INVALID');
        }
        if (state) {
            const user = await User.findById(payload._id).exec();
            if (!user || user.status !== IUserStatusEnum.ACTIVE || user.role !== payload.role || audienceForRole(user.role) !== audience || Boolean(user.must_change_pin) !== state.restricted) {
                await this.revoke(payload._id, payload.sid, { reasonCode: 'ACCOUNT_SECURITY_STATE_CHANGED' });
                throw new DomainError('الحساب غير موجود أو غير مفعّل', 401, 'REFRESH_ACCOUNT_INVALID');
            }
        }
        const newJti = crypto.randomUUID(), now = new Date().toISOString();
        const nextState: SessionState = state ? { ...state, currentRefreshHash: hash(newJti), lastRefreshedAt: now } : {
            userId: payload._id, role: payload.role, audience, restricted: false, currentRefreshHash: hash(newJti), createdAt: now, lastRefreshedAt: now,
        };
        let result: number;
        try {
            result = Number(await RedisClient.getInstance().eval(ROTATE_SCRIPT, [key, usedRefreshKey(payload._id, payload.sid, payload.jti)], [hash(payload.jti), JSON.stringify(nextState), String(SESSION_TTL)]));
        } catch { throw new DomainError('تعذر تحديث الجلسة', 503, 'SESSION_STORE_UNAVAILABLE'); }
        if (result === 2) {
            await record('REFRESH_TOKEN_REUSE_DETECTED', payload._id, payload.sid, { ip: context.ip, reasonCode: 'CONSUMED_REFRESH_REUSED' });
            throw new DomainError('تم اكتشاف إعادة استخدام رمز التحديث', 401, 'REFRESH_REUSE_DETECTED');
        }
        if (result !== 1 || !state) throw new DomainError('تم إلغاء رمز التحديث', 401, 'REFRESH_REVOKED');
        const accessToken = signAccessToken({ _id: payload._id, role: payload.role, sid: payload.sid, audience });
        const refreshToken = signRefreshToken({ _id: payload._id, role: payload.role, sid: payload.sid, jti: newJti, audience });
        await record('SESSION_REFRESHED', payload._id, payload.sid, { deviceId: state.deviceId, deviceName: state.deviceName, platform: state.platform, ip: context.ip });
        return { accessToken, refreshToken, mustChangePin: nextState.restricted, sessionId: payload.sid };
    }

    async revoke(userId: string, sid: string, context: EventContext = {}): Promise<number> {
        let revoked: number;
        try { revoked = await RedisClient.getInstance().del(sessionKey(userId, sid)); }
        catch { throw new DomainError('تعذر إلغاء الجلسة', 503, 'SESSION_STORE_UNAVAILABLE'); }
        if (revoked) await record('SESSION_REVOKED', userId, sid, context);
        return revoked;
    }

    async revokeAll(userId: string, context: EventContext = {}): Promise<number> {
        try {
            const redis = RedisClient.getInstance(), revoked = await redis.deleteByPattern(`session:${userId}:*`);
            await redis.deleteByPattern(`refresh-used:${userId}:*`);
            await record('ALL_SESSIONS_REVOKED', userId, 'all', context);
            return revoked;
        } catch (error) {
            if (error instanceof DomainError) throw error;
            throw new DomainError('تعذر إلغاء الجلسات', 503, 'SESSION_STORE_UNAVAILABLE');
        }
    }

    async count(userId: string): Promise<number> { return RedisClient.getInstance().countByPattern(`session:${userId}:*`); }
}
export default new SessionService();
