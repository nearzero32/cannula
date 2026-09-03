import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import Elysia from 'elysia';
import { rateLimit } from 'elysia-rate-limit';
import mongoose from 'mongoose';
import { Value } from '@sinclair/typebox/value';
import { homeCareAdminController } from '../src/controller/dash/admin/home-care.controller';
import { mobileHomeCareController } from '../src/controller/mobile/home-care.controller';
import homeCareCategoryService from '../src/services/home-care-category.service';
import homeCareServiceService from '../src/services/home-care-service.service';
import homeCarePolicyService from '../src/services/home-care-policy.service';
import { HomeCareValidationError } from '../src/services/home-care.validation';
import RedisClient from '../src/databases/redis';
import { signAccessToken, TokenAudienceEnum } from '../src/constants/jwt';
import sessionService from '../src/services/session.service';
import { IUserRoleEnum } from '../src/interfaces/user.interface';
import { IHomeCareStatusEnum } from '../src/interfaces/home-care.interface';
import Admin from '../src/models/admins.model';
import { IAdminPermissionEnum } from '../src/interfaces/admin.interface';
import {
    BadRequestResponseSchema,
    ConflictResponseSchema,
    ForbiddenResponseSchema,
    InternalServerErrorResponseSchema,
    NotFoundResponseSchema,
    RATE_LIMIT_RESPONSE,
    RateLimitResponseSchema,
    UnauthorizedResponseSchema,
    ValidationErrorResponseSchema,
} from '../src/schemas/api-response.schema';
import {
    HomeCareCategoryResponseSchema,
    MobileHomeCareCategoryListResponseSchema,
} from '../src/schemas/home-care-response.schema';

const adminId = '507f1f77bcf86cd799439011';
const query = <T>(value: T) => ({ select() { return this; }, lean() { return this; }, exec: async () => value });

function categoryDocument() {
    const now = new Date('2026-08-28T12:00:00.000Z');
    return {
        _id: new mongoose.Types.ObjectId('507f191e810c19729de860ea'),
        name: 'تمريض',
        description: null,
        icon: null,
        image: null,
        status: IHomeCareStatusEnum.ACTIVE,
        display_order: 2,
        created_by: new mongoose.Types.ObjectId(adminId),
        createdAt: now,
        updatedAt: now,
    };
}

function authorizedRequest(path: string, init?: RequestInit): Request {
    const token = signAccessToken({ _id: adminId, role: IUserRoleEnum.ADMIN, sid: '12345678-1234-4234-8234-123456789012', audience: TokenAudienceEnum.DASHBOARD });
    const headers = new Headers(init?.headers);
    headers.set('authorization', `Bearer ${token}`);
    if (init?.body) headers.set('content-type', 'application/json');
    return new Request(`http://localhost${path}`, { ...init, headers });
}

async function json(response: Response): Promise<Record<string, unknown>> {
    return await response.json() as Record<string, unknown>;
}

beforeEach(() => {
    spyOn(sessionService, 'validateAccess').mockImplementation(async payload => ({ sid: payload.sid, userId: payload._id, role: payload.role, audience: payload.aud, restricted: false, currentRefreshDigest: 'hash', createdAt: '', lastSeenAt: '', lastRefreshedAt: '', expiresAt: '' }));
    spyOn(Admin, 'findOne').mockReturnValue(query({ is_active: true, super_admin: false, permissions: [IAdminPermissionEnum.MANAGE_HOME_CARE] }) as never);
});

afterEach(() => mock.restore());

describe('Home Care runtime response contracts', () => {
    test('200 mobile success matches its documented schema', async () => {
        spyOn(homeCareCategoryService, 'listActive').mockResolvedValue([categoryDocument()] as never);
        const response = await mobileHomeCareController.handle(new Request('http://localhost/home-care/categories'));
        const body = await json(response);
        expect(response.status).toBe(200);
        expect(Value.Check(MobileHomeCareCategoryListResponseSchema, body)).toBe(true);
    });

    test('201 category creation matches its documented schema', async () => {
        spyOn(homeCarePolicyService, 'getAccess').mockResolvedValue('manage');
        spyOn(homeCareCategoryService, 'create').mockResolvedValue(categoryDocument() as never);
        const response = await homeCareAdminController.handle(authorizedRequest('/home-care/categories/', {
            method: 'POST', body: JSON.stringify({ name: 'تمريض', displayOrder: 2 }),
        }));
        const body = await json(response);
        expect(response.status).toBe(201);
        expect(Value.Check(HomeCareCategoryResponseSchema, body)).toBe(true);
    });

    test('400 invalid identifier matches the bad-request schema', async () => {
        const response = await mobileHomeCareController.handle(
            new Request('http://localhost/home-care/services/not-an-object-id')
        );
        const body = await json(response);
        expect(response.status).toBe(400);
        expect(Value.Check(BadRequestResponseSchema, body)).toBe(true);
    });

    test('401 missing authentication matches the unauthorized schema', async () => {
        const response = await homeCareAdminController.handle(
            new Request('http://localhost/home-care/categories/')
        );
        const body = await json(response);
        expect(response.status).toBe(401);
        expect(Value.Check(UnauthorizedResponseSchema, body)).toBe(true);
    });

    test('403 normal admin mutation matches the forbidden schema', async () => {
        (Admin.findOne as any).mockReturnValue(query({ is_active: true, super_admin: false, permissions: [] }));
        const response = await homeCareAdminController.handle(authorizedRequest('/home-care/categories/', {
            method: 'POST', body: JSON.stringify({ name: 'تمريض' }),
        }));
        const body = await json(response);
        expect(response.status).toBe(403);
        expect(Value.Check(ForbiddenResponseSchema, body)).toBe(true);
    });

    test('404 missing service matches the not-found schema', async () => {
        spyOn(homeCareServiceService, 'getActiveById').mockResolvedValue(null);
        const response = await mobileHomeCareController.handle(
            new Request('http://localhost/home-care/services/507f191e810c19729de860ea')
        );
        const body = await json(response);
        expect(response.status).toBe(404);
        expect(Value.Check(NotFoundResponseSchema, body)).toBe(true);
    });

    test('409 duplicate active category matches the conflict schema', async () => {
        spyOn(homeCarePolicyService, 'getAccess').mockResolvedValue('manage');
        spyOn(homeCareCategoryService, 'create').mockRejectedValue(
            new HomeCareValidationError('يوجد نوع رعاية منزلية فعال بهذا الاسم', 409)
        );
        const response = await homeCareAdminController.handle(authorizedRequest('/home-care/categories/', {
            method: 'POST', body: JSON.stringify({ name: 'تمريض' }),
        }));
        const body = await json(response);
        expect(response.status).toBe(409);
        expect(Value.Check(ConflictResponseSchema, body)).toBe(true);
    });

    test('422 native Elysia validation matches the documented validation schema', async () => {
        spyOn(homeCarePolicyService, 'getAccess').mockResolvedValue('manage');
        const response = await homeCareAdminController.handle(authorizedRequest('/home-care/categories/', {
            method: 'POST', body: JSON.stringify({ displayOrder: 1 }),
        }));
        const body = await json(response);
        expect(response.status).toBe(422);
        expect(Value.Check(ValidationErrorResponseSchema, body)).toBe(true);
    });

    test('429 rate limiter payload matches the reusable documented schema', async () => {
        const app = new Elysia()
            .use(rateLimit({
                duration: 60_000,
                max: 1,
                errorResponse: new Response(JSON.stringify(RATE_LIMIT_RESPONSE), {
                    status: 429, headers: { 'content-type': 'application/json' },
                }),
            }))
            .get('/', () => ({ error: false }));
        await app.handle(new Request('http://localhost/'));
        const response = await app.handle(new Request('http://localhost/'));
        const body = await json(response);
        expect(response.status).toBe(429);
        expect(Value.Check(RateLimitResponseSchema, body)).toBe(true);
    });

    test('500 unexpected failure is safe and matches the internal-error schema', async () => {
        spyOn(homeCareCategoryService, 'listActive').mockRejectedValue(new Error('sensitive database detail'));
        const response = await mobileHomeCareController.handle(new Request('http://localhost/home-care/categories'));
        const body = await json(response);
        expect(response.status).toBe(500);
        expect(body.message).toBe('حدث خطأ في الخادم');
        expect(JSON.stringify(body)).not.toContain('sensitive database detail');
        expect(Value.Check(InternalServerErrorResponseSchema, body)).toBe(true);
    });
});
