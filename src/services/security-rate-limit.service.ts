import crypto from 'node:crypto';
import RedisClient from '../databases/redis';
import { DomainError } from './domain-error';

const FIXED_WINDOW_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('TTL', KEYS[1])
return {current <= tonumber(ARGV[2]) and 1 or 0, math.max(0, tonumber(ARGV[2]) - current), ttl}
`;
export const AUTH_RATE_POLICIES = {
    OTP_START_PHONE:{limit:5,window:600}, OTP_START_IP:{limit:30,window:600}, OTP_RESEND_PHONE:{limit:6,window:600}, OTP_RESEND_IP:{limit:30,window:600},
    OTP_VERIFY_PHONE:{limit:20,window:600}, OTP_VERIFY_IP:{limit:60,window:600}, PIN_PHONE:{limit:5,window:600}, PIN_IP:{limit:30,window:600},
    SUPPORT_ADMIN:{limit:10,window:3600}, SUPPORT_FLOW:{limit:2,window:600}, UPLOAD_USER:{limit:10,window:60}, NOTIFICATION_GUEST_WRITE:{limit:30,window:60},
} as const;
export type AuthRatePolicy = keyof typeof AUTH_RATE_POLICIES;
export interface RateLimitResult { allowed:boolean; remaining:number; retryAfterSeconds:number }
function secret(): string { const value=process.env.OTP_HASH_SECRET?.trim(); if(!value) throw new DomainError('خدمة الحماية غير مهيأة',503,'AUTH_SECURITY_UNAVAILABLE'); return value; }
export function digestRateIdentity(value:string):string{return crypto.createHmac('sha256',secret()).update(value).digest('hex')}
class SecurityRateLimitService {
    key(policy:AuthRatePolicy,identity:string){return `security:rl:${policy.toLowerCase()}:${digestRateIdentity(identity)}`}
    async consume(policy:AuthRatePolicy,identity:string):Promise<RateLimitResult>{const p=AUTH_RATE_POLICIES[policy];try{const raw=await RedisClient.getInstance().eval(FIXED_WINDOW_LUA,[this.key(policy,identity)],[String(p.window),String(p.limit)]);if(!Array.isArray(raw)||raw.length<3)throw new Error('invalid limiter reply');return{allowed:Number(raw[0])===1,remaining:Number(raw[1]),retryAfterSeconds:Math.max(1,Number(raw[2]))}}catch(error){if(error instanceof DomainError)throw error;throw new DomainError('خدمة الحماية غير متاحة مؤقتاً',503,'AUTH_RATE_LIMIT_UNAVAILABLE')}}
    async enforce(policy:AuthRatePolicy,identity:string,code='AUTH_RATE_LIMITED'){const result=await this.consume(policy,identity);if(!result.allowed){const error=new DomainError('طلبات كثيرة، حاول لاحقاً',429,code) as DomainError&{retryAfterSeconds?:number};error.retryAfterSeconds=result.retryAfterSeconds;throw error}return result}
    async check(policy:AuthRatePolicy,identity:string,code='AUTH_RATE_LIMITED'){const p=AUTH_RATE_POLICIES[policy];try{const key=this.key(policy,identity),client=RedisClient.getInstance();const raw=await client.get(key);if(raw===null)return{allowed:true,remaining:p.limit,retryAfterSeconds:0};const count=Number(raw);const ttl=await client.getClient().ttl(key);const result={allowed:count<p.limit,remaining:Math.max(0,p.limit-count),retryAfterSeconds:Math.max(1,ttl)};if(!result.allowed){const error=new DomainError('طلبات كثيرة، حاول لاحقاً',429,code) as DomainError&{retryAfterSeconds?:number};error.retryAfterSeconds=result.retryAfterSeconds;throw error}return result}catch(error){if(error instanceof DomainError)throw error;throw new DomainError('خدمة الحماية غير متاحة مؤقتاً',503,'AUTH_RATE_LIMIT_UNAVAILABLE')}}
    async reset(policy:AuthRatePolicy,identity:string){try{await RedisClient.getInstance().del(this.key(policy,identity))}catch{throw new DomainError('خدمة الحماية غير متاحة مؤقتاً',503,'AUTH_RATE_LIMIT_UNAVAILABLE')}}
}
export { FIXED_WINDOW_LUA };
export default new SecurityRateLimitService();
