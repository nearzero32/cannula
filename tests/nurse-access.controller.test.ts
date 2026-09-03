import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { authController } from '../src/controller/dash/auth.controller';
import { nurseHomeCareController } from '../src/controller/dash/nurse/home-care.controller';
import RedisClient from '../src/databases/redis';
import userService from '../src/services/user.service';
import ActivityLogService from '../src/services/activity-log.service';
import dispatchService from '../src/services/home-care-dispatch.service';
import nurseService from '../src/services/nurse.service';
import { signAccessToken, TokenAudienceEnum } from '../src/constants/jwt';
import sessionService from '../src/services/session.service';
import { IUserRoleEnum } from '../src/interfaces/user.interface';
import { DomainError } from '../src/services/domain-error';

const userId = '507f191e810c19729de86401';
function request(path: string, role: 'admin' | 'doctor' | 'nurse' | 'patient') {
    const headers = { authorization: `Bearer ${signAccessToken({ _id: userId, role, sid: '12345678-1234-4234-8234-123456789012', audience: TokenAudienceEnum.DASHBOARD })}` };
    return new Request(`http://localhost${path}`, { headers });
}
beforeEach(() => {
    spyOn(sessionService, 'validateAccess').mockImplementation(async payload => ({ sid: payload.sid, userId: payload._id, role: payload.role, audience: payload.aud, restricted: false, currentRefreshDigest: 'hash', createdAt: '', lastSeenAt: '', lastRefreshedAt: '', expiresAt: '' }));
    spyOn(sessionService, 'create').mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh', mustChangePin: false, sessionId: '12345678-1234-4234-8234-123456789012' });
});
afterEach(() => mock.restore());

describe('Nurse dashboard identity and authorization', () => {
    test('active Nurse can use the existing dashboard login flow', async () => {
        spyOn(userService, 'findByCredentials').mockResolvedValue({ _id: userId, full_name: 'سارة', phone: '0770', role: IUserRoleEnum.NURSE, status: 'active' } as never);
        spyOn(ActivityLogService, 'logActivity').mockResolvedValue({} as never);
        const response = await authController.handle(new Request('http://localhost/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: '0770', password: 'secret' }) }));
        const body: any = await response.json();
        expect(response.status).toBe(200);
        expect(body.data.user.role).toBe(IUserRoleEnum.NURSE);
    });

    for (const role of [IUserRoleEnum.PATIENT, IUserRoleEnum.DOCTOR]) {
        test(`${role} cannot access Nurse APIs`, async () => {
            const available = spyOn(dispatchService, 'listAvailable');
            const response = await nurseHomeCareController.handle(request('/home-care/available', role));
            expect(response.status).toBe(403);
            expect(available).not.toHaveBeenCalled();
        });
    }

    test('inactive or suspended Nurse cannot access the operational pool', async () => {
        for (const state of ['inactive', 'suspended']) {
            spyOn(nurseService, 'requireActiveByUserId').mockRejectedValue(new DomainError(`حساب ${state}`, 403));
            const response = await nurseHomeCareController.handle(request('/home-care/available', IUserRoleEnum.NURSE));
            expect(response.status).toBe(403);
            mock.restore();
            spyOn(sessionService, 'validateAccess').mockImplementation(async payload => ({ sid: payload.sid, userId: payload._id, role: payload.role, audience: payload.aud, restricted: false, currentRefreshDigest: 'hash', createdAt: '', lastSeenAt: '', lastRefreshedAt: '', expiresAt: '' }));
        }
    });

    test('another Nurse request is hidden as 404', async () => {
        spyOn(dispatchService, 'getMine').mockResolvedValue(null);
        const response = await nurseHomeCareController.handle(request('/home-care/507f191e810c19729de86402', IUserRoleEnum.NURSE));
        expect(response.status).toBe(404);
    });
});
