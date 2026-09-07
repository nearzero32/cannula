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
const slot = (overrides: any = {}) => ({ _id: new mongoose.Types.ObjectId(slotId), service_id: new mongoose.Types.ObjectId(serviceId), time: '11:00', status: 'active', display_order: 10, created_by: new mongoose.Types.ObjectId(adminId), createdAt: new Date('2026-09-07T00:00:00Z'), updatedAt: new Date('2026-09-07T00:00:00Z'), ...overrides });
function dashboard(path: string, init: RequestInit = {}) { const token = signAccessToken({ _id: adminId, role: IUserRoleEnum.ADMIN, sid: '12345678-1234-4234-8234-123456789012', audience: TokenAudienceEnum.DASHBOARD }); const headers = new Headers(init.headers); headers.set('authorization', `Bearer ${token}`); if (init.body) headers.set('content-type', 'application/json'); return new Request(`http://localhost${path}`, { ...init, headers }); }

beforeEach(() => {
    spyOn(sessionService, 'validateAccess').mockImplementation(async payload => ({ sid: payload.sid, userId: payload._id, role: payload.role, audience: payload.aud, restricted: false, currentRefreshDigest: 'hash', createdAt: '', lastSeenAt: '', lastRefreshedAt: '', expiresAt: '' }));
    spyOn(Admin, 'findOne').mockReturnValue(query({ is_active: true, super_admin: false, permissions: [IAdminPermissionEnum.MANAGE_HOME_CARE] }) as never);
    spyOn(homeCarePolicyService, 'getAccess').mockResolvedValue('manage');
});
afterEach(() => mock.restore());

describe('Home Care availability HTTP contracts', () => {
    test('dashboard exposes list/create/edit/status/archive and bulk replacement', async () => {
        spyOn(homeCareAvailabilityService, 'listForDashboard').mockResolvedValue([slot()] as never);
        spyOn(homeCareAvailabilityService, 'create').mockResolvedValue(slot() as never);
        spyOn(homeCareAvailabilityService, 'update').mockResolvedValue(slot({ time: '14:00' }) as never);
        spyOn(homeCareAvailabilityService, 'updateStatus').mockResolvedValue(slot({ status: 'inactive' }) as never);
        spyOn(homeCareAvailabilityService, 'archive').mockResolvedValue(slot({ status: 'inactive' }) as never);
        spyOn(homeCareAvailabilityService, 'replace').mockResolvedValue([slot({ time: '09:00' }), slot({ _id: new mongoose.Types.ObjectId(), time: '14:00', display_order: 20 })] as never);
        const calls: Array<[string, string, any?]> = [
            ['GET', `/home-care/services/${serviceId}/availability`],
            ['POST', `/home-care/services/${serviceId}/availability`, { time: '11:00', display_order: 10 }],
            ['PUT', `/home-care/services/${serviceId}/availability`, { times: ['09:00', '14:00'] }],
            ['PATCH', `/home-care/services/${serviceId}/availability/${slotId}`, { time: '14:00' }],
            ['PATCH', `/home-care/services/${serviceId}/availability/${slotId}/status`, { status: 'inactive' }],
            ['DELETE', `/home-care/services/${serviceId}/availability/${slotId}`],
        ];
        for (const [method, path, body] of calls) {
            const response = await homeCareAdminController.handle(dashboard(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) }));
            expect(response.status).toBe(method === 'POST' ? 201 : 200);
        }
    });

    test('dashboard permission guard blocks slot mutation before service access', async () => {
        (Admin.findOne as any).mockReturnValue(query({ is_active: true, super_admin: false, permissions: [] }));
        const create = spyOn(homeCareAvailabilityService, 'create');
        const response = await homeCareAdminController.handle(dashboard(`/home-care/services/${serviceId}/availability`, { method: 'POST', body: JSON.stringify({ time: '11:00' }) }));
        expect(response.status).toBe(403);
        expect(create).not.toHaveBeenCalled();
    });

    test('mobile availability returns the requested service/date and canonical slots', async () => {
        const list = spyOn(homeCareAvailabilityService, 'listForMobile').mockResolvedValue([slot()] as never);
        const response = await mobileHomeCareController.handle(new Request(`http://localhost/home-care/services/${serviceId}/availability?date=2026-09-07`));
        const body: any = await response.json();
        expect(response.status).toBe(200);
        expect(body.data).toEqual({ service_id: serviceId, date: '2026-09-07', timezone: 'Asia/Baghdad', slots: [{ _id: slotId, time: '11:00' }] });
        expect(list).toHaveBeenCalledWith(serviceId, '2026-09-07');
    });
});
