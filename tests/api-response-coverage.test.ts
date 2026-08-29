import { describe, expect, test } from 'bun:test';
import Elysia, { t } from 'elysia';
import { swagger } from '@elysiajs/swagger';
import { Value } from '@sinclair/typebox/value';
import { dashboardController } from '../src/controller/dash/index';
import { mobileController } from '../src/controller/mobile/index';
import { swaggerConfig } from '../src/constants/swagger.config';
import { ApiErrorPlugin } from '../src/middleware/api-error.middleware';
import {
    BadRequestResponseSchema,
    InternalServerErrorResponseSchema,
    NotFoundResponseSchema,
} from '../src/schemas/api-response.schema';

interface OpenApiOperation {
    responses?: Record<string, unknown>;
}

interface OpenApiDocument {
    paths?: Record<string, Record<string, OpenApiOperation>>;
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
    return await response.json() as Record<string, unknown>;
}

describe('API response documentation coverage', () => {
    test('every registered dashboard and mobile route declares response schemas', () => {
        const routes = [...dashboardController.routes, ...mobileController.routes];
        expect(routes.length).toBeGreaterThan(0);

        for (const route of routes) {
            const response = route.hooks?.response;
            expect(response, `${route.method} ${route.path}`).toBeDefined();
            expect(Object.keys(response as object).length, `${route.method} ${route.path}`).toBeGreaterThan(0);
        }
    });

    test('generated OpenAPI documents responses, rate limits, and server errors for every operation', async () => {
        const app = new Elysia({ prefix: '/api' })
            .use(swagger(swaggerConfig))
            .use(dashboardController)
            .use(mobileController);
        const response = await app.handle(new Request('http://localhost/api/swagger/json'));
        const document = await response.json() as OpenApiDocument;
        const operations: Array<{ path: string; method: string; operation: OpenApiOperation }> = [];

        for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
            for (const [method, operation] of Object.entries(pathItem)) {
                if (['get', 'post', 'put', 'patch', 'delete'].includes(method)) {
                    operations.push({ path, method, operation });
                }
            }
        }

        expect(operations.length).toBeGreaterThanOrEqual(70);
        for (const { path, method, operation } of operations) {
            const codes = Object.keys(operation.responses ?? {});
            expect(codes.length, `${method.toUpperCase()} ${path}`).toBeGreaterThan(0);
            expect(codes, `${method.toUpperCase()} ${path}`).toContain('429');
            expect(codes, `${method.toUpperCase()} ${path}`).toContain('500');
        }
    });

    test('public routes do not falsely document authentication errors', async () => {
        const app = new Elysia({ prefix: '/api' })
            .use(swagger(swaggerConfig))
            .use(dashboardController)
            .use(mobileController);
        const response = await app.handle(new Request('http://localhost/api/swagger/json'));
        const document = await response.json() as OpenApiDocument;
        const publicPaths = [
            '/api/mobile/about-us/',
            '/api/mobile/ads/',
            '/api/mobile/doctors/',
            '/api/mobile/home-care/categories',
        ];

        for (const path of publicPaths) {
            const codes = Object.keys(document.paths?.[path]?.get?.responses ?? {});
            expect(codes, path).not.toContain('401');
            expect(codes, path).not.toContain('403');
        }
        expect(Object.keys(document.paths?.['/api/mobile/profile/']?.get?.responses ?? {})).toContain('401');
    });
});

describe('global framework error contracts', () => {
    test('malformed JSON returns the documented Arabic 400 envelope', async () => {
        const app = new Elysia()
            .use(ApiErrorPlugin)
            .post('/body', () => ({ error: false }), { body: t.Object({ name: t.String() }) });
        const response = await app.handle(new Request('http://localhost/body', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad-json',
        }));
        const body = await responseBody(response);
        expect(response.status).toBe(400);
        expect(Value.Check(BadRequestResponseSchema, body)).toBe(true);
    });

    test('unknown routes return the documented Arabic 404 envelope', async () => {
        const app = new Elysia().use(ApiErrorPlugin).get('/known', () => 'ok');
        const response = await app.handle(new Request('http://localhost/missing'));
        const body = await responseBody(response);
        expect(response.status).toBe(404);
        expect(Value.Check(NotFoundResponseSchema, body)).toBe(true);
    });

    test('unexpected exceptions return a safe documented 500 envelope', async () => {
        const app = new Elysia().use(ApiErrorPlugin).get('/boom', () => {
            throw new Error('private infrastructure detail');
        });
        const response = await app.handle(new Request('http://localhost/boom'));
        const body = await responseBody(response);
        expect(response.status).toBe(500);
        expect(Value.Check(InternalServerErrorResponseSchema, body)).toBe(true);
        expect(JSON.stringify(body)).not.toContain('private infrastructure detail');
    });
});

