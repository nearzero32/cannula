import { afterEach, describe, expect, test } from 'bun:test';
import Elysia from 'elysia';
import { openapi } from '@elysia/openapi';
import { assertProductionConfiguration, isSwaggerEnabled, parseAllowedOrigins, requestBodyLimitBytes } from '../src/config/production.config';
import { HttpSecurityPlugin } from '../src/middleware/http-security.middleware';
import { ApiErrorPlugin } from '../src/middleware/api-error.middleware';
import { safeSearchPattern } from '../src/services/search-safety.service';
import { swaggerConfig } from '../src/constants/swagger.config';

const originalNodeEnv = process.env.NODE_ENV;
const originalPublicHttps = process.env.PUBLIC_HTTPS;
const originalSwaggerEnabled = process.env.ENABLE_SWAGGER;
const originalSwaggerUsername = process.env.SWAGGER_USERNAME;
const originalSwaggerPassword = process.env.SWAGGER_PASSWORD;
afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalPublicHttps === undefined) delete process.env.PUBLIC_HTTPS;
    else process.env.PUBLIC_HTTPS = originalPublicHttps;
    if (originalSwaggerEnabled === undefined) delete process.env.ENABLE_SWAGGER; else process.env.ENABLE_SWAGGER = originalSwaggerEnabled;
    if (originalSwaggerUsername === undefined) delete process.env.SWAGGER_USERNAME; else process.env.SWAGGER_USERNAME = originalSwaggerUsername;
    if (originalSwaggerPassword === undefined) delete process.env.SWAGGER_PASSWORD; else process.env.SWAGGER_PASSWORD = originalSwaggerPassword;
});

const validProduction = {
    NODE_ENV: 'production',
    ACCESS_TOKEN_SECRET: 'access-0123456789abcdef0123456789abcdef',
    REFRESH_TOKEN_SECRET: 'refresh-0123456789abcdef0123456789abcdef',
    OTP_HASH_SECRET: 'otp-0123456789abcdef0123456789abcdef',
    OTP_DEBUG_RETURN_CODE: 'false',
    ALLOWED_ORIGINS: 'https://dashboard.cannula.app,https://app.cannula.app:443',
    MONGODB_URI: 'mongodb://app:password@mongo:27017/cannula?replicaSet=rs0&authSource=cannula',
    MONGODB_INTERNAL_NETWORK: 'true',
    REDIS_HOST: 'redis',
    REDIS_PASSWORD: 'redis-password',
    REDIS_INTERNAL_NETWORK: 'true',
    ENABLE_SWAGGER: 'false',
    PUBLIC_HTTPS: 'true',
};

describe('Phase 6 production configuration', () => {
    test('accepts independent strong secrets and explicit private dependency boundaries', () => {
        expect(() => assertProductionConfiguration(validProduction)).not.toThrow();
    });

    test('rejects weak, repeated, and debug secrets without echoing values', () => {
        expect(() => assertProductionConfiguration({ ...validProduction, ACCESS_TOKEN_SECRET: 'short' })).toThrow('SECURITY_CONFIG_WEAK:ACCESS_TOKEN_SECRET');
        expect(() => assertProductionConfiguration({ ...validProduction, REFRESH_TOKEN_SECRET: validProduction.ACCESS_TOKEN_SECRET })).toThrow('SECURITY_CONFIG_REUSED:AUTH_SECRETS');
        expect(() => assertProductionConfiguration({ ...validProduction, OTP_DEBUG_RETURN_CODE: 'true' })).toThrow('OTP_DEBUG_RETURN_CODE=true');
    });

    test('rejects wildcard/non-HTTPS origins and normalizes exact origins', () => {
        expect(() => parseAllowedOrigins({ NODE_ENV: 'production', ALLOWED_ORIGINS: '*' })).toThrow('ALLOWED_ORIGINS');
        expect(() => parseAllowedOrigins({ NODE_ENV: 'production', ALLOWED_ORIGINS: 'http://cannula.app' })).toThrow('ALLOWED_ORIGINS');
        expect(parseAllowedOrigins(validProduction)).toEqual(['https://dashboard.cannula.app', 'https://app.cannula.app']);
    });

    test('requires authenticated Redis and Mongo plus an explicit transport boundary', () => {
        expect(() => assertProductionConfiguration({ ...validProduction, REDIS_PASSWORD: '' })).toThrow('REDIS_PASSWORD');
        expect(() => assertProductionConfiguration({ ...validProduction, MONGODB_URI: 'mongodb://mongo:27017/cannula?replicaSet=rs0' })).toThrow('MONGODB_CREDENTIALS');
        expect(() => assertProductionConfiguration({ ...validProduction, REDIS_INTERNAL_NETWORK: 'false' })).toThrow('REDIS_TRANSPORT');
    });

    test('Swagger is production-off by default and body size is bounded', () => {
        expect(isSwaggerEnabled({ NODE_ENV: 'production' })).toBe(false);
        expect(isSwaggerEnabled({ NODE_ENV: 'development' })).toBe(true);
        expect(requestBodyLimitBytes({})).toBe(2 * 1024 * 1024);
        expect(() => requestBodyLimitBytes({ REQUEST_BODY_LIMIT_BYTES: '99999999' })).toThrow('REQUEST_BODY_LIMIT_BYTES');
    });

    test('requires strong Basic credentials only when production Swagger is enabled', () => {
        expect(() => assertProductionConfiguration({ ...validProduction, ENABLE_SWAGGER: 'true' })).toThrow('SWAGGER_USERNAME');
        expect(() => assertProductionConfiguration({ ...validProduction, ENABLE_SWAGGER: 'true', SWAGGER_USERNAME: 'docs', SWAGGER_PASSWORD: 'short' })).toThrow('SWAGGER_PASSWORD');
        expect(() => assertProductionConfiguration({ ...validProduction, ENABLE_SWAGGER: 'true', SWAGGER_USERNAME: 'docs-admin', SWAGGER_PASSWORD: '8ryq2L9pX4vK7mN1cD6hJ0sT3wF5bG8eQ2zA9uR' })).not.toThrow();
    });

    test('search patterns are literal and bounded', () => {
        expect(safeSearchPattern('a.*(b)+')).toBe('a\\.\\*\\(b\\)\\+');
        expect(() => safeSearchPattern('x'.repeat(129))).toThrow();
        try { safeSearchPattern('x'.repeat(129)); } catch (error) { expect(error).toMatchObject({ code: 'SEARCH_TOO_LONG', status: 422 }); }
    });
});

describe('Phase 6 HTTP boundary', () => {
    test('adds a server request ID and restrictive headers without trusting client ID', async () => {
        process.env.NODE_ENV = 'production';
        process.env.PUBLIC_HTTPS = 'true';
        const app = new Elysia({ prefix: '/api' }).use(HttpSecurityPlugin).get('/probe', () => ({ ok: true }));
        const response = await app.handle(new Request('http://localhost/api/probe', { headers: { 'X-Request-Id': 'attacker-value' } }));
        expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
        expect(response.headers.get('x-request-id')).not.toBe('attacker-value');
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
        expect(response.headers.get('strict-transport-security')).toBe('max-age=31536000');
        expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    });

    test('unknown errors are redacted and correlated', async () => {
        process.env.NODE_ENV = 'production';
        process.env.PUBLIC_HTTPS = 'true';
        const app = new Elysia({ prefix: '/api' }).use(HttpSecurityPlugin).use(ApiErrorPlugin).get('/explode', () => { throw new Error('mongodb://user:password@internal/path'); });
        const response = await app.handle(new Request('http://localhost/api/explode'));
        const payload = await response.json() as Record<string, unknown>;
        expect(response.status).toBe(500);
        expect(JSON.stringify(payload)).not.toContain('password');
        expect(payload.code).toBe('INTERNAL_SERVER_ERROR');
        expect(payload.requestId).toBe(response.headers.get('x-request-id'));
    });

    test('production Swagger is hidden when disabled and Basic-authenticated when enabled', async () => {
        process.env.NODE_ENV = 'production'; process.env.PUBLIC_HTTPS = 'true'; process.env.ENABLE_SWAGGER = 'false';
        const app = new Elysia({ prefix: '/api' }).use(HttpSecurityPlugin).use(openapi(swaggerConfig)).get('/probe', () => ({ ok: true }));
        for (const path of ['/api/swagger', '/api/swagger/json', '/api/swagger/assets/example.js']) {
            const response = await app.handle(new Request(`http://localhost${path}`));
            expect(response.status).toBe(404);
            expect(await response.json()).toMatchObject({ error: true, message: 'المسار غير موجود' });
        }

        process.env.ENABLE_SWAGGER = 'true'; process.env.SWAGGER_USERNAME = 'docs-admin'; process.env.SWAGGER_PASSWORD = '8ryq2L9pX4vK7mN1cD6hJ0sT3wF5bG8eQ2zA9uR';
        const unauthorized = await app.handle(new Request('http://localhost/api/swagger'));
        expect(unauthorized.status).toBe(401); expect(unauthorized.headers.get('www-authenticate')).toBe('Basic realm="Cannula Swagger", charset="UTF-8"'); expect(unauthorized.headers.get('cache-control')).toBe('no-store');
        for (const header of ['Basic bad!', 'Bearer unrelated-token', 'Basic ZG9jcy1hZG1pbg==', `Basic ${Buffer.from('wrong:wrong-password').toString('base64')}`]) {
            expect((await app.handle(new Request('http://localhost/api/swagger', { headers: { authorization: header } }))).status).toBe(401);
        }
        const authorization = `Basic ${Buffer.from(`${process.env.SWAGGER_USERNAME}:${process.env.SWAGGER_PASSWORD}`).toString('base64')}`;
        const html = await app.handle(new Request('http://localhost/api/swagger', { headers: { authorization } }));
        expect(html.status).toBe(200); expect(html.headers.get('content-security-policy')).toBeNull(); expect(await html.text()).toContain('api-reference');
        const spec = await app.handle(new Request('http://localhost/api/swagger/json', { headers: { authorization } }));
        expect(spec.status).toBe(200); expect(await spec.json()).toMatchObject({ openapi: expect.any(String), components: { securitySchemes: { bearerAuth: { scheme: 'bearer' } } } });
        expect((await app.handle(new Request('http://localhost/api/probe'))).status).toBe(200);
    });

    test('Swagger Basic Auth is also enforced in development', async () => {
        process.env.NODE_ENV = 'development'; process.env.ENABLE_SWAGGER = 'true'; process.env.SWAGGER_USERNAME = 'docs-admin'; process.env.SWAGGER_PASSWORD = '8ryq2L9pX4vK7mN1cD6hJ0sT3wF5bG8eQ2zA9uR';
        const app = new Elysia({ prefix: '/api' }).use(HttpSecurityPlugin).get('/swagger', () => ({ docs: true }));
        expect((await app.handle(new Request('http://localhost/api/swagger'))).status).toBe(401);
        const authorization = `Basic ${Buffer.from(`${process.env.SWAGGER_USERNAME}:${process.env.SWAGGER_PASSWORD}`).toString('base64')}`;
        expect((await app.handle(new Request('http://localhost/api/swagger', { headers: { authorization } }))).status).toBe(200);
    });
});
