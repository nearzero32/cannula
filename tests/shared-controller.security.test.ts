import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import Elysia from 'elysia';
import { openapi } from '@elysia/openapi';
import { dashboardController } from '../src/controller/dash';
import { mobileController } from '../src/controller/mobile';
import { swaggerConfig } from '../src/constants/swagger.config';
import { SWAGGER_TAGS } from '../src/constants/swagger-tags';
import { signAccessToken, TokenAudienceEnum, type TokenAudience } from '../src/constants/jwt';
import { IUserRoleEnum, type IUserRole } from '../src/interfaces/user.interface';
import sessionService from '../src/services/session.service';
import uploadPolicyService from '../src/services/upload-policy.service';

const userId = '507f191e810c19729de86401';
const patientId = '507f191e810c19729de86402';
const sid = '12345678-1234-4234-8234-123456789012';
const body = { purpose: 'PATIENT_PROFILE_PHOTO', targetId: patientId, contentType: 'image/png' };

function accessToken(role: IUserRole, audience: TokenAudience) {
    return signAccessToken({ _id: userId, role, sid, audience });
}

function request(path: string, token?: string) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    return new Request(`http://localhost${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}

function app() {
    return new Elysia({ prefix: '/api' }).use(dashboardController).use(mobileController);
}

beforeEach(() => {
    process.env.ACCESS_TOKEN_SECRET = 'shared-controller-access-secret-long-enough';
    spyOn(sessionService, 'validateAccess').mockImplementation(async payload => ({
        sid: payload.sid, userId: payload._id, role: payload.role, audience: payload.aud,
        restricted: false, currentRefreshDigest: 'hash', createdAt: '', lastSeenAt: '', lastRefreshedAt: '', expiresAt: '',
    }));
});

afterEach(() => mock.restore());

describe('shared upload controller surface isolation', () => {
    test('Dashboard roles and Mobile Patient reach the shared business service with the correct audience', async () => {
        const initiate = spyOn(uploadPolicyService, 'initiate').mockResolvedValue({ uploadId: 'upload-id' } as never);
        for (const role of [IUserRoleEnum.ADMIN, IUserRoleEnum.DOCTOR, IUserRoleEnum.NURSE, IUserRoleEnum.PHARMACY]) {
            const response = await app().handle(request('/api/dash/upload/intents', accessToken(role, TokenAudienceEnum.DASHBOARD)));
            expect(response.status, role).toBe(201);
            expect(initiate.mock.calls[initiate.mock.calls.length - 1]?.[1]).toMatchObject({ role, audience: TokenAudienceEnum.DASHBOARD });
        }
        const mobile = await app().handle(request('/api/mobile/upload/intents', accessToken(IUserRoleEnum.PATIENT, TokenAudienceEnum.MOBILE)));
        expect(mobile.status).toBe(201);
        expect(initiate.mock.calls[initiate.mock.calls.length - 1]?.[1]).toMatchObject({ role: IUserRoleEnum.PATIENT, audience: TokenAudienceEnum.MOBILE });
    });

    test('tokens cannot cross surfaces, and correct-audience unsupported roles are forbidden', async () => {
        const initiate = spyOn(uploadPolicyService, 'initiate').mockResolvedValue({ uploadId: 'upload-id' } as never);
        const mobileOnDashboard = await app().handle(request('/api/dash/upload/intents', accessToken(IUserRoleEnum.PATIENT, TokenAudienceEnum.MOBILE)));
        const dashboardOnMobile = await app().handle(request('/api/mobile/upload/intents', accessToken(IUserRoleEnum.ADMIN, TokenAudienceEnum.DASHBOARD)));
        expect(mobileOnDashboard.status).toBe(401);
        expect(dashboardOnMobile.status).toBe(401);

        const patientDashboardToken = await app().handle(request('/api/dash/upload/intents', accessToken(IUserRoleEnum.PATIENT, TokenAudienceEnum.DASHBOARD)));
        const adminMobileToken = await app().handle(request('/api/mobile/upload/intents', accessToken(IUserRoleEnum.ADMIN, TokenAudienceEnum.MOBILE)));
        expect(patientDashboardToken.status).toBe(403);
        expect(adminMobileToken.status).toBe(403);
        expect(initiate).not.toHaveBeenCalled();
    });

    test('missing tokens and revoked sessions return 401 before upload policy evaluation', async () => {
        const initiate = spyOn(uploadPolicyService, 'initiate').mockResolvedValue({ uploadId: 'upload-id' } as never);
        expect((await app().handle(request('/api/mobile/upload/intents'))).status).toBe(401);
        mock.restore();
        const policy = spyOn(uploadPolicyService, 'initiate').mockResolvedValue({ uploadId: 'upload-id' } as never);
        spyOn(sessionService, 'validateAccess').mockResolvedValue(null);
        const revoked = await app().handle(request('/api/mobile/upload/intents', accessToken(IUserRoleEnum.PATIENT, TokenAudienceEnum.MOBILE)));
        expect(revoked.status).toBe(401);
        expect(initiate).not.toHaveBeenCalled();
        expect(policy).not.toHaveBeenCalled();
    });

    test('registers exactly the six surface-specific routes and no shared public surface', () => {
        const routes = app().routes
            .filter(route => route.path.includes('/upload/'))
            .map(route => `${route.method} ${route.path}`);
        expect(routes).toEqual([
            'POST /api/dash/upload/intents',
            'POST /api/dash/upload/intents/:uploadId/complete',
            'GET /api/dash/upload/assets/:uploadId/access',
            'POST /api/mobile/upload/intents',
            'POST /api/mobile/upload/intents/:uploadId/complete',
            'GET /api/mobile/upload/assets/:uploadId/access',
        ]);
        expect(routes.some(route => route.includes('/api/shared/'))).toBe(false);
    });

    test('OpenAPI assigns Dashboard and Mobile uploads to distinct defined tags without duplicates', async () => {
        const documented = new Elysia({ prefix: '/api' }).use(openapi(swaggerConfig)).use(dashboardController).use(mobileController);
        const document = await (await documented.handle(new Request('http://localhost/api/swagger/json'))).json() as any;
        const cases = [
            ['/api/dash/upload/intents', 'post', SWAGGER_TAGS.DASHBOARD.SHARED],
            ['/api/dash/upload/intents/{uploadId}/complete', 'post', SWAGGER_TAGS.DASHBOARD.SHARED],
            ['/api/dash/upload/assets/{uploadId}/access', 'get', SWAGGER_TAGS.DASHBOARD.SHARED],
            ['/api/mobile/upload/intents', 'post', SWAGGER_TAGS.MOBILE.UPLOADS],
            ['/api/mobile/upload/intents/{uploadId}/complete', 'post', SWAGGER_TAGS.MOBILE.UPLOADS],
            ['/api/mobile/upload/assets/{uploadId}/access', 'get', SWAGGER_TAGS.MOBILE.UPLOADS],
        ] as const;
        for (const [path, method, tag] of cases) expect(document.paths?.[path]?.[method]?.tags).toEqual([tag]);
        expect(document.tags.filter((entry: any) => entry.name === SWAGGER_TAGS.MOBILE.UPLOADS)).toHaveLength(1);
    });
});
