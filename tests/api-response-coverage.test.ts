import { describe, expect, test } from 'bun:test';
import Elysia, { t } from 'elysia';
import { swagger } from '@elysiajs/swagger';
import { Value } from '@sinclair/typebox/value';
import { dashboardController } from '../src/controller/dash/index';
import { mobileController } from '../src/controller/mobile/index';
import { swaggerConfig } from '../src/constants/swagger.config';
import { ApiErrorPlugin } from '../src/middleware/api-error.middleware';
import { SWAGGER_TAG_DEFINITIONS, SWAGGER_TAG_GROUPS, SWAGGER_TAGS } from '../src/constants/swagger-tags';
import {
    BadRequestResponseSchema,
    InternalServerErrorResponseSchema,
    NotFoundResponseSchema,
} from '../src/schemas/api-response.schema';

interface OpenApiOperation {
    responses?: Record<string, unknown>;
    tags?: string[];
}

interface OpenApiDocument {
    paths?: Record<string, Record<string, OpenApiOperation>>;
    tags?: Array<{ name: string; description?: string; 'x-displayName'?: string }>;
    'x-tagGroups'?: Array<{ name: string; tags: string[] }>;
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

    test('uses ordered role-domain tags without generic parent-tag inheritance', async () => {
        const app = new Elysia({ prefix: '/api' })
            .use(swagger(swaggerConfig))
            .use(dashboardController)
            .use(mobileController);
        const response = await app.handle(new Request('http://localhost/api/swagger/json'));
        const document = await response.json() as OpenApiDocument;

        expect(document.tags?.map(tag => tag.name)).toEqual(
            SWAGGER_TAG_DEFINITIONS.map(tag => tag.name)
        );
        expect(document['x-tagGroups']).toEqual(SWAGGER_TAG_GROUPS);
        expect(document['x-tagGroups']?.map(group => group.name)).toEqual([
            'Dashboard',
            'Admin',
            'Doctor',
            'Nurse',
            'Pharmacy',
            'Mobile',
        ]);

        const groupsByName = new Map(document['x-tagGroups']?.map(group => [group.name, group.tags]));
        expect(groupsByName.get('Admin')).toEqual(expect.arrayContaining([
            SWAGGER_TAGS.ADMIN.CLINICS,
            SWAGGER_TAGS.ADMIN.APPOINTMENTS,
            SWAGGER_TAGS.ADMIN.HOME_CARE,
        ]));
        expect(groupsByName.get('Doctor')).toEqual(expect.arrayContaining([
            SWAGGER_TAGS.DOCTOR.PROFILE,
            SWAGGER_TAGS.DOCTOR.APPOINTMENTS,
        ]));
        expect(groupsByName.get('Mobile')).toEqual(expect.arrayContaining([
            SWAGGER_TAGS.MOBILE.AUTH,
            SWAGGER_TAGS.MOBILE.APPOINTMENTS,
            SWAGGER_TAGS.MOBILE.HOME_CARE,
        ]));
        expect(groupsByName.get('Nurse')).toEqual([
            SWAGGER_TAGS.NURSE.PROFILE,
            SWAGGER_TAGS.NURSE.HOME_CARE,
        ]);

        const tagDefinitions = new Map(document.tags?.map(tag => [tag.name, tag]));
        expect(tagDefinitions.get(SWAGGER_TAGS.ADMIN.CLINICS)?.['x-displayName']).toBe('Clinics');
        expect(tagDefinitions.get(SWAGGER_TAGS.DOCTOR.APPOINTMENTS)?.['x-displayName']).toBe('Appointments');
        expect(tagDefinitions.get(SWAGGER_TAGS.MOBILE.HOME_CARE)?.['x-displayName']).toBe('Home Care');
        for (const tag of document.tags ?? []) {
            expect(tag['x-displayName']?.trim(), tag.name).toBeTruthy();
        }

        const definedTagNames = new Set(document.tags?.map(tag => tag.name));
        const groupedTagNames = document['x-tagGroups']?.flatMap(group => group.tags) ?? [];
        expect(groupedTagNames.length).toBe(definedTagNames.size);
        expect(new Set(groupedTagNames).size).toBe(groupedTagNames.length);
        for (const tag of groupedTagNames) {
            expect(definedTagNames.has(tag), tag).toBe(true);
        }

        const expectedTags: Array<[string, string, string]> = [
            ['post', '/api/dash/auth/login', SWAGGER_TAGS.DASHBOARD.AUTH],
            ['post', '/api/dash/upload/presign', SWAGGER_TAGS.DASHBOARD.SHARED],
            ['get', '/api/dash/admin/clinics/', SWAGGER_TAGS.ADMIN.CLINICS],
            ['get', '/api/dash/admin/doctors/', SWAGGER_TAGS.ADMIN.DOCTORS],
            ['get', '/api/dash/admin/patients/', SWAGGER_TAGS.ADMIN.PATIENTS],
            ['get', '/api/dash/admin/appointments/', SWAGGER_TAGS.ADMIN.APPOINTMENTS],
            ['get', '/api/dash/admin/home-care/categories/', SWAGGER_TAGS.ADMIN.HOME_CARE],
            ['get', '/api/dash/admin/home-care/services/', SWAGGER_TAGS.ADMIN.HOME_CARE],
            ['get', '/api/dash/admin/home-care/requests/', SWAGGER_TAGS.ADMIN.HOME_CARE],
            ['get', '/api/dash/doctor/profile/', SWAGGER_TAGS.DOCTOR.PROFILE],
            ['get', '/api/dash/doctor/appointments/', SWAGGER_TAGS.DOCTOR.APPOINTMENTS],
            ['get', '/api/dash/doctor/secretaries/', SWAGGER_TAGS.DOCTOR.SECRETARIES],
            ['get', '/api/dash/admin/nurses/', SWAGGER_TAGS.ADMIN.NURSES],
            ['get', '/api/dash/nurse/profile', SWAGGER_TAGS.NURSE.PROFILE],
            ['get', '/api/dash/nurse/home-care/available', SWAGGER_TAGS.NURSE.HOME_CARE],
            ['patch', '/api/dash/nurse/home-care/{id}/claim', SWAGGER_TAGS.NURSE.HOME_CARE],
            ['patch', '/api/dash/admin/home-care/requests/{id}/assign', SWAGGER_TAGS.ADMIN.HOME_CARE],
            ['get', '/api/dash/admin/home-care/requests/{id}/history', SWAGGER_TAGS.ADMIN.HOME_CARE],
            ['post', '/api/mobile/auth/register', SWAGGER_TAGS.MOBILE.AUTH],
            ['get', '/api/mobile/doctors/', SWAGGER_TAGS.MOBILE.DOCTORS],
            ['post', '/api/mobile/appointments/', SWAGGER_TAGS.MOBILE.APPOINTMENTS],
            ['get', '/api/mobile/home-care/categories', SWAGGER_TAGS.MOBILE.HOME_CARE],
            ['get', '/api/mobile/home-care/requests/', SWAGGER_TAGS.MOBILE.HOME_CARE],
        ];

        for (const [method, path, tag] of expectedTags) {
            const operation = document.paths?.[path]?.[method];
            expect(operation, `${method.toUpperCase()} ${path}`).toBeDefined();
            expect(operation?.tags, `${method.toUpperCase()} ${path}`).toEqual([tag]);
        }

        for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
            for (const [method, operation] of Object.entries(pathItem)) {
                if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
                expect(operation.tags, `${method.toUpperCase()} ${path}`).not.toContain('Dash');
                expect(operation.tags, `${method.toUpperCase()} ${path}`).not.toContain('Mobile');
                expect(operation.tags?.length, `${method.toUpperCase()} ${path}`).toBe(1);
                expect(definedTagNames.has(operation.tags?.[0] ?? ''), `${method.toUpperCase()} ${path}`).toBe(true);
            }
        }
        const historyPath = document.paths?.['/api/dash/admin/home-care/requests/{id}/history'];
        expect(historyPath?.get).toBeDefined();
        expect(historyPath?.post).toBeUndefined();
        expect(historyPath?.patch).toBeUndefined();
        expect(historyPath?.delete).toBeUndefined();
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
