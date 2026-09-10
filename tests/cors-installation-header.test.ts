import { describe, expect, test } from 'bun:test';
import Elysia from 'elysia';
import { cors } from '@elysiajs/cors';
import { CORS_ALLOWED_HEADERS } from '../src/constants/cors.config';

describe('browser notification CORS headers', () => {
    test('preflight explicitly permits installation, authorization, and content headers', async () => {
        const app = new Elysia().use(cors({
            origin: ['https://app.cannula.test'],
            methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
            allowedHeaders: CORS_ALLOWED_HEADERS,
            credentials: true,
        })).get('/notifications', () => ({ ok: true }));
        const response = await app.handle(new Request('http://localhost/notifications', {
            method: 'OPTIONS',
            headers: {
                origin: 'https://app.cannula.test',
                'access-control-request-method': 'PATCH',
                'access-control-request-headers': 'x-installation-id, authorization, content-type',
            },
        }));
        const allowed = response.headers.get('access-control-allow-headers')?.toLowerCase() ?? '';
        expect(response.status).toBeLessThan(400);
        expect(response.headers.get('access-control-allow-origin')).toBe('https://app.cannula.test');
        expect(response.headers.get('access-control-allow-credentials')).toBe('true');
        for (const header of ['x-installation-id', 'authorization', 'content-type']) expect(allowed).toContain(header);
    });
});
