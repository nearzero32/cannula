import {beforeEach,afterEach,describe,expect,mock,spyOn,test} from 'bun:test';
import {resolveClientIpFromPeer} from '../src/services/client-ip.service';
import {assertTrustedProxyConfiguration,trustedProxyCidrs} from '../src/config/trusted-proxy.config';
import {normalizePhone,OTP_RESEND_COOLDOWN_SECONDS} from '../src/services/patient-auth.service';
import securityRateLimitService,{AUTH_RATE_POLICIES,digestRateIdentity} from '../src/services/security-rate-limit.service';
import RedisClient from '../src/databases/redis';

beforeEach(()=>{process.env.OTP_HASH_SECRET='phase5-test-otp-secret-long-enough'});afterEach(()=>mock.restore());
const headers=(values:Record<string,string>)=>new Headers(values);

describe('Phase 5 trusted client IP and limiter contracts',()=>{
 test('untrusted direct peers ignore every spoofable forwarding header',()=>{const h=headers({'x-forwarded-for':'198.51.100.7','x-real-ip':'198.51.100.8','cf-connecting-ip':'198.51.100.9'});expect(resolveClientIpFromPeer('203.0.113.20',h,['127.0.0.1/32'])).toBe('203.0.113.20')});
 test('trusted multi-proxy chain walks right-to-left to the first untrusted hop',()=>{const h=headers({'x-forwarded-for':'198.51.100.7, 10.2.3.4'});expect(resolveClientIpFromPeer('::ffff:127.0.0.1',h,['127.0.0.1/32','10.0.0.0/8'])).toBe('198.51.100.7')});
 test('malformed forwarded chains are rejected and IPv4-mapped peers normalize',()=>{expect(resolveClientIpFromPeer('::ffff:127.0.0.1',headers({'x-forwarded-for':'198.51.100.7, garbage'}),['127.0.0.1/32'])).toBe('127.0.0.1')});
 test('trusted proxy CIDRs validate IPv4 and IPv6 without trust-all',()=>{expect(trustedProxyCidrs({TRUSTED_PROXY_CIDRS:'127.0.0.1/32,::1/128'} as any)).toEqual(['127.0.0.1/32','::1/128']);expect(()=>assertTrustedProxyConfiguration({TRUSTED_PROXY_CIDRS:'10.0.0.0/99'} as any)).toThrow('invalid CIDR')});
 test('phone formats collapse to one limiter identity and keys contain no phone',()=>{const a=normalizePhone('0770 123-4567'),b=normalizePhone('+964 770 123 4567');expect(a).toBe(b);const key=securityRateLimitService.key('PIN_PHONE',a);expect(key).not.toContain(a);expect(digestRateIdentity(a)).toHaveLength(64)});
 test('numeric policies and cooldown are bounded and explicit',()=>{expect(OTP_RESEND_COOLDOWN_SECONDS).toBe(45);expect(AUTH_RATE_POLICIES.PIN_PHONE).toEqual({limit:5,window:600});expect(AUTH_RATE_POLICIES.UPLOAD_USER).toEqual({limit:10,window:60})});
 test('Redis failure fails closed with a safe 503',async()=>{spyOn(RedisClient.getInstance(),'eval').mockRejectedValue(new Error('secret provider detail'));await expect(securityRateLimitService.consume('OTP_START_PHONE','07701234567')).rejects.toMatchObject({status:503,code:'AUTH_RATE_LIMIT_UNAVAILABLE'})});
});
