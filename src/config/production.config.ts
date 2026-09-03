import { assertOtpDebugConfiguration } from './otp-debug.config';
import { assertProductionSecurityConfiguration } from './security.config';
import { assertTrustedProxyConfiguration } from './trusted-proxy.config';
import { loadR2ConfigFromEnv } from '../constants/r2.config';

export type ProductionEnvironment = Record<string, string | undefined>;

export class ProductionConfigurationError extends Error {
    constructor(public readonly code: string, variable: string) {
        super(`${code}:${variable}`);
        this.name = 'ProductionConfigurationError';
    }
}

const SECRET_NAMES = ['ACCESS_TOKEN_SECRET', 'REFRESH_TOKEN_SECRET', 'OTP_HASH_SECRET'] as const;
const OBVIOUS_SECRET = /^(.)\1+$|^(password|secret|changeme|change-me|default|example|test)([-_ ].*)?$/i;

function flag(env: ProductionEnvironment, name: string): boolean {
    return env[name]?.trim().toLowerCase() === 'true';
}

function validateSecrets(env: ProductionEnvironment): void {
    const values = SECRET_NAMES.map(name => env[name]!.trim());
    for (let index = 0; index < values.length; index++) {
        const value = values[index];
        const name = SECRET_NAMES[index];
        if (value.length < 32) throw new ProductionConfigurationError('SECURITY_CONFIG_WEAK', name);
        const repeatedChunk = Array.from({ length: 8 }, (_, i) => i + 1).some(size => value.length % size === 0 && value === value.slice(0, size).repeat(value.length / size));
        if (OBVIOUS_SECRET.test(value) || repeatedChunk) throw new ProductionConfigurationError('SECURITY_CONFIG_WEAK', name);
    }
    if (new Set(values).size !== values.length) throw new ProductionConfigurationError('SECURITY_CONFIG_REUSED', 'AUTH_SECRETS');
}

export function parseAllowedOrigins(env: ProductionEnvironment = process.env): string[] {
    const raw = env.ALLOWED_ORIGINS ?? '';
    const production = env.NODE_ENV === 'production';
    const values = raw.split(',').map(value => value.trim()).filter(Boolean);
    if (production && values.length === 0) throw new ProductionConfigurationError('SECURITY_CONFIG_MISSING', 'ALLOWED_ORIGINS');

    const normalized = values.map(value => {
        if (value === '*') throw new ProductionConfigurationError('SECURITY_CONFIG_INVALID', 'ALLOWED_ORIGINS');
        let url: URL;
        try { url = new URL(value); } catch { throw new ProductionConfigurationError('SECURITY_CONFIG_INVALID', 'ALLOWED_ORIGINS'); }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
            throw new ProductionConfigurationError('SECURITY_CONFIG_INVALID', 'ALLOWED_ORIGINS');
        }
        if (production && url.protocol !== 'https:') throw new ProductionConfigurationError('SECURITY_CONFIG_INVALID', 'ALLOWED_ORIGINS');
        return url.origin;
    });
    return [...new Set(normalized)];
}

function validateMongo(env: ProductionEnvironment): void {
    const raw = env.MONGODB_URI?.trim();
    if (!raw) throw new ProductionConfigurationError('SECURITY_CONFIG_MISSING', 'MONGODB_URI');
    let uri: URL;
    try { uri = new URL(raw); } catch { throw new ProductionConfigurationError('SECURITY_CONFIG_INVALID', 'MONGODB_URI'); }
    if (!['mongodb:', 'mongodb+srv:'].includes(uri.protocol)) throw new ProductionConfigurationError('SECURITY_CONFIG_INVALID', 'MONGODB_URI');
    const hasCredentials = Boolean((uri.username && uri.password) || (env.MONGODB_USER?.trim() && env.MONGODB_PASSWORD));
    if (!hasCredentials) throw new ProductionConfigurationError('SECURITY_CONFIG_MISSING', 'MONGODB_CREDENTIALS');
    if (uri.protocol === 'mongodb:' && !uri.searchParams.get('replicaSet')) throw new ProductionConfigurationError('SECURITY_CONFIG_MISSING', 'MONGODB_REPLICA_SET');
    if (!flag(env, 'MONGODB_TLS') && !flag(env, 'MONGODB_INTERNAL_NETWORK')) throw new ProductionConfigurationError('SECURITY_CONFIG_INSECURE', 'MONGODB_TRANSPORT');
}

function validateRedis(env: ProductionEnvironment): void {
    if (!env.REDIS_HOST?.trim()) throw new ProductionConfigurationError('SECURITY_CONFIG_MISSING', 'REDIS_HOST');
    if (!env.REDIS_PASSWORD?.trim()) throw new ProductionConfigurationError('SECURITY_CONFIG_MISSING', 'REDIS_PASSWORD');
    if (!flag(env, 'REDIS_TLS') && !flag(env, 'REDIS_INTERNAL_NETWORK')) throw new ProductionConfigurationError('SECURITY_CONFIG_INSECURE', 'REDIS_TRANSPORT');
}

export function isSwaggerEnabled(env: ProductionEnvironment = process.env): boolean {
    return env.NODE_ENV !== 'production' ? env.ENABLE_SWAGGER !== 'false' : flag(env, 'ENABLE_SWAGGER');
}

export function assertProductionConfiguration(env: ProductionEnvironment = process.env): void {
    assertTrustedProxyConfiguration(env as NodeJS.ProcessEnv);
    if (env.NODE_ENV !== 'production') return;
    assertProductionSecurityConfiguration(env);
    assertOtpDebugConfiguration(env);
    validateSecrets(env);
    parseAllowedOrigins(env);
    validateMongo(env);
    validateRedis(env);
    if (!flag(env, 'PUBLIC_HTTPS')) throw new ProductionConfigurationError('SECURITY_CONFIG_INSECURE', 'PUBLIC_HTTPS');
    loadR2ConfigFromEnv(env as NodeJS.ProcessEnv);
    if (isSwaggerEnabled(env)) {
        const token = env.SWAGGER_ADMIN_TOKEN?.trim() ?? '';
        if (token.length < 32 || OBVIOUS_SECRET.test(token)) throw new ProductionConfigurationError('SECURITY_CONFIG_WEAK', 'SWAGGER_ADMIN_TOKEN');
    }
}

export function requestBodyLimitBytes(env: ProductionEnvironment = process.env): number {
    const raw = env.REQUEST_BODY_LIMIT_BYTES?.trim();
    if (!raw) return 2 * 1024 * 1024;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 64 * 1024 || value > 10 * 1024 * 1024) {
        throw new ProductionConfigurationError('SECURITY_CONFIG_INVALID', 'REQUEST_BODY_LIMIT_BYTES');
    }
    return value;
}
