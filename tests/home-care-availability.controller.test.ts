import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import mongoose from 'mongoose';
import { homeCareAdminController } from '../src/controller/dash/admin/home-care.controller';
import { mobileHomeCareController } from '../src/controller/mobile/home-care.controller';
import homeCareAvailabilityService from '../src/services/home-care-availability.service';
import homeCarePolicyService from '../src/services/home-care-policy.service';
import sessionService from '../src/services/session.service';
import Admin from '../src/models/admins.model';
import { signAccessToken, TokenAudienceEnum } from '../src/constants/jwt';
import { IAdminPermissionEnum } from '../src/interfaces/admin.interface';
import { IUserRoleEnum } from '../src/interfaces/user.interface';

const adminId = '507f191e810c19729de86201', serviceId = '507f191e810c19729de86202', slotId = '507f191e810c19729de86203';
const query = (value: any) => ({ select() { return this; }, lean() { return this; }, exec: async () => value });
const weekdays = ['SATURDAY', 'SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'] as const;
const schedule = () => weekdays.map(day_of_week => ({ day_of_week, times: day_of_week === 'SATURDAY' ? ['11:00'] : [] }));
function dashboard(path: string, init: RequestInit = {}) { const token = signAccessToken({ _id: adminId, role: IUserRoleEnum.ADMIN, sid: '12345678-1234-4234-8234-123456789012', audience: TokenAudienceEnum.DASHBOARD }); const headers = new Headers(init.headers); headers.set('authorization', `Bearer ${token}`); if (init.body) headers.set('content-type', 'application/json'); return new Request(`http://localhost${path}`, { ...init, headers }); }

beforeEach(() => {
    spyOn(sessionService, 'validateAccess').mockImplementation(async payload => ({ sid: payload.sid, userId: payload._id, role: payload.role, audience: payload.aud, restricted: false, currentRefreshDigest: 'hash', createdAt: '', lastSeenAt: '', lastRefreshedAt: '', expiresAt: '' }));
    spyOn(Admin, 'findOne').mockReturnValue(query({ is_active: true, super_admin: false, permissions: [IAdminPermissionEnum.MANAGE_HOME_CARE] }) as never);
    spyOn(homeCarePolicyService, 'getAccess').mockResolvedValue('manage');
});
afterEach(() => mock.restore());

describe('Home Care availability HTTP contracts', () => {
    test('dashboard exposes one full-week GET and one atomic full-week PUT', async () => {
        const data = { service_id: serviceId, timezone: 'Asia/Baghdad' as const, schedule: schedule() as never };
        spyOn(homeCareAvailabilityService, 'listForDashboard').mockResolvedValue(data);
        const replace = spyOn(homeCareAvailabilityService, 'replaceWeekly').mockResolvedValue(data);
        const getResponse = await homeCareAdminController.handle(dashboard(`/home-care/services/${serviceId}/availability`));
        const getBody: any = await getResponse.json();
        expect(getResponse.status).toBe(200);
        expect(getBody.data.schedule).toHaveLength(7);
        expect(getBody.data.schedule[6]).toEqual({ day_of_week: 'FRIDAY', times: [] });
        const putResponse = await homeCareAdminController.handle(dashboard(`/home-care/services/${serviceId}/availability`, { method: 'PUT', body: JSON.stringify({ schedule: schedule() }) }));
        expect(putResponse.status).toBe(200);
        expect(replace).toHaveBeenCalledWith(serviceId, { schedule: schedule() }, expect.anything());
    });

    test('legacy individual slot CRUD routes are removed', async () => {
        for (const [method, path, body] of [
            ['POST', `/home-care/services/${serviceId}/availability`, { time: '11:00' }],
            ['PATCH', `/home-care/services/${serviceId}/availability/${slotId}`, { time: '12:00' }],
            ['DELETE', `/home-care/services/${serviceId}/availability/${slotId}`, undefined],
        ] as const) {
            const response = await homeCareAdminController.handle(dashboard(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) }));
            expect(response.status).toBe(404);
        }
    });

    test('dashboard permission guard remains unchanged for weekly mutation', async () => {
        (Admin.findOne as any).mockReturnValue(query({ is_active: true, super_admin: false, permissions: [] }));
        const replace = spyOn(homeCareAvailabilityService, 'replaceWeekly');
        const response = await homeCareAdminController.handle(dashboard(`/home-care/services/${serviceId}/availability`, { method: 'PUT', body: JSON.stringify({ schedule: schedule() }) }));
        expect(response.status).toBe(403);
        expect(replace).not.toHaveBeenCalled();
    });

    test('dashboard weekly body strips unexpected properties under the existing strict DTO convention', async () => {
        const data = { service_id: serviceId, timezone: 'Asia/Baghdad' as const, schedule: schedule() as never };
        const replace = spyOn(homeCareAvailabilityService, 'replaceWeekly').mockResolvedValue(data);
        const response = await homeCareAdminController.handle(dashboard(`/home-care/services/${serviceId}/availability`, {
            method: 'PUT', body: JSON.stringify({ schedule: schedule(), enabled: true }),
        }));
        expect(response.status).toBe(200);
        expect(replace.mock.calls[0]?.[1]).toEqual({ schedule: schedule() });
    });

    test('mobile response contract remains service/date/timezone/slots', async () => {
        spyOn(homeCareAvailabilityService, 'listForMobile').mockResolvedValue([{ _id: new mongoose.Types.ObjectId(slotId), time: '11:00' }] as never);
        const response = await mobileHomeCareController.handle(new Request(`http://localhost/home-care/services/${serviceId}/availability?date=2026-09-12`));
        const body: any = await response.json();
        expect(response.status).toBe(200);
        expect(body.data).toEqual({ service_id: serviceId, date: '2026-09-12', timezone: 'Asia/Baghdad', slots: [{ _id: slotId, time: '11:00' }] });
    });
});
