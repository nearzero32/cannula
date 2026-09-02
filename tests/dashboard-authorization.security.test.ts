import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { dashboardController } from '../src/controller/dash';
import { mobileController } from '../src/controller/mobile';
import RedisClient from '../src/databases/redis';
import Admin from '../src/models/admins.model';
import patientService from '../src/services/patient.service';
import doctorService from '../src/services/doctor.service';
import nurseService from '../src/services/nurse.service';
import pharmacyService from '../src/services/pharmacy.service';
import activityLogService from '../src/services/activity-log.service';
import authEventService from '../src/services/auth-event.service';
import storageService from '../src/services/storage.service';
import { signAccessToken, TokenAudienceEnum } from '../src/constants/jwt';
import sessionService from '../src/services/session.service';
import { IAdminPermissionEnum, type IAdminPermission } from '../src/interfaces/admin.interface';
import { IUserRoleEnum, type IUserRole } from '../src/interfaces/user.interface';

const userId = '507f191e810c19729de86401';
const objectId = '507f191e810c19729de86402';
const query = <T>(value: T) => ({ select() { return this; }, lean() { return this; }, exec: async () => value });

const sid = '12345678-1234-4234-8234-123456789012';
function token(role: IUserRole, path: string) {
    const audience = path.includes('/mobile/') ? TokenAudienceEnum.MOBILE : TokenAudienceEnum.DASHBOARD;
    return signAccessToken({ _id: userId, role, sid, audience });
}

function request(path: string, role?: IUserRole, method = 'GET', body?: unknown) {
    const headers: Record<string, string> = {};
    if (role) headers.authorization = `Bearer ${token(role, path)}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    return new Request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

function adminProfile(permissions: IAdminPermission[] = [], super_admin = false) {
    return { user_id: userId, is_active: true, super_admin, permissions };
}

function materialize(path: string) {
    return path.replace(':flowId', 'flow-id-12345678901234567890').replace(/:id|:patientId/g, objectId);
}

beforeEach(() => {
    process.env.ACCESS_TOKEN_SECRET = 'test-access-secret-that-is-long-enough';
    spyOn(sessionService, 'validateAccess').mockImplementation(async payload => ({ userId: payload._id, role: payload.role, audience: payload.aud, restricted: false, currentRefreshHash: 'hash', createdAt: '', lastRefreshedAt: '' }));
});
afterEach(() => mock.restore());

describe('Dashboard cross-surface authorization', () => {
    test('every registered Admin GET rejects a Patient before controller data access', async () => {
        const routes = dashboardController.routes.filter(route => route.method === 'GET' && route.path.startsWith('/dash/admin/'));
        expect(routes.length).toBeGreaterThan(20);
        for (const route of routes) {
            const response = await dashboardController.handle(request(materialize(route.path), IUserRoleEnum.PATIENT));
            expect(response.status, `${route.method} ${route.path}`).toBe(403);
            expect(await response.json()).toEqual({ error: true, message: 'غير مصرح لك بالوصول' });
        }
    });

    test('Patient cannot mutate patients, create clinics, or manage doctors, nurses, and pharmacies', async () => {
        const cases: Array<[string, string, unknown]> = [
            ['PATCH', `/dash/admin/patients/${objectId}/status`, { status: 'active' }],
            ['POST', '/dash/admin/clinics/', { name: 'Clinic', address: 'Baghdad' }],
            ['POST', '/dash/admin/doctors/', { user_id: objectId, full_name: 'Doctor', display_name: 'Doctor', specialty: objectId }],
            ['POST', '/dash/admin/nurses/', { user_id: objectId, full_name: 'Nurse', qualified_service_ids: [] }],
            ['POST', '/dash/admin/pharmacies/', { name: 'Pharmacy', phone: '07700000000', password: 'password1', address: { address_text: 'Baghdad address' } }],
        ];
        for (const [method, path, body] of cases) {
            const response = await dashboardController.handle(request(path, IUserRoleEnum.PATIENT, method, body));
            expect(response.status, `${method} ${path}`).toBe(403);
        }
    });

    for (const role of [IUserRoleEnum.DOCTOR, IUserRoleEnum.NURSE, IUserRoleEnum.PHARMACY]) {
        test(`${role} cannot access Admin routes`, async () => {
            const response = await dashboardController.handle(request('/dash/admin/patients/', role));
            expect(response.status).toBe(403);
        });
    }

    test('Admin cannot use Doctor, Nurse, or Pharmacy operational surfaces', async () => {
        for (const path of ['/dash/doctor/profile/', '/dash/nurse/profile', '/dash/pharmacy/profile']) {
            const response = await dashboardController.handle(request(path, IUserRoleEnum.ADMIN));
            expect(response.status, path).toBe(403);
        }
    });

    test('each operational role reaches its own surface', async () => {
        const doctorLookup = spyOn(doctorService, 'getByUserId').mockResolvedValue(null);
        const doctor = await dashboardController.handle(request('/dash/doctor/profile/', IUserRoleEnum.DOCTOR));
        expect(doctor.status).toBe(404); expect(doctorLookup).toHaveBeenCalled();

        const nurseLookup = spyOn(nurseService, 'getByUserId').mockResolvedValue(null);
        const nurse = await dashboardController.handle(request('/dash/nurse/profile', IUserRoleEnum.NURSE));
        expect(nurse.status).toBe(404); expect(nurseLookup).toHaveBeenCalled();

        const pharmacyLookup = spyOn(pharmacyService, 'getByUserId').mockResolvedValue(null);
        const pharmacy = await dashboardController.handle(request('/dash/pharmacy/profile', IUserRoleEnum.PHARMACY));
        expect(pharmacy.status).toBe(404); expect(pharmacyLookup).toHaveBeenCalled();
    });

    test('Patient cannot access dashboard upload and dashboard roles can pass its role guard', async () => {
        spyOn(storageService, 'isConfigured').mockReturnValue(false);
        const body = { folder: 'patients', contentType: 'image/png' };
        const denied = await dashboardController.handle(request('/dash/upload/presign', IUserRoleEnum.PATIENT, 'POST', body));
        expect(denied.status).toBe(403);
        const allowed = await dashboardController.handle(request('/dash/upload/presign', IUserRoleEnum.DOCTOR, 'POST', body));
        expect(allowed.status).toBe(503);
    });

    test('unauthenticated remains 401 while authenticated wrong-role is 403', async () => {
        expect((await dashboardController.handle(request('/dash/admin/patients/'))).status).toBe(401);
        expect((await dashboardController.handle(request('/dash/admin/patients/', IUserRoleEnum.PATIENT))).status).toBe(403);
    });

    test('non-Patient roles cannot use protected Patient mobile business routes', async () => {
        for (const role of [IUserRoleEnum.ADMIN, IUserRoleEnum.DOCTOR, IUserRoleEnum.NURSE, IUserRoleEnum.PHARMACY]) {
            const response = await mobileController.handle(request('/mobile/profile/', role));
            expect(response.status, role).toBe(403);
        }
        const lookup = spyOn(patientService, 'getByUserId').mockResolvedValue(null);
        const patient = await mobileController.handle(request('/mobile/profile/', IUserRoleEnum.PATIENT));
        expect(patient.status).toBe(404); expect(lookup).toHaveBeenCalled();
    });
});

describe('Admin permission enforcement', () => {
    test('every registered Admin route carries namespace role enforcement and a permission policy', () => {
        const routes = dashboardController.routes.filter(route => route.path.startsWith('/dash/admin/'));
        expect(routes.length).toBeGreaterThan(80);
        for (const route of routes) {
            const beforeHandleCount = (route.hooks as any)?.beforeHandle?.length ?? 0;
            const expectedMinimum = route.path.startsWith('/dash/admin/auth-security/') ? 1 : 2;
            expect(beforeHandleCount, `${route.method} ${route.path}`).toBeGreaterThanOrEqual(expectedMinimum);
        }
    });

    test('Admin without manage_patients is denied, with permission is allowed, and Super Admin bypasses', async () => {
        const findAdmin = spyOn(Admin, 'findOne').mockReturnValue(query(adminProfile()) as never);
        const list = spyOn(patientService, 'getPaginated').mockResolvedValue({ data: [], count: 0 } as never);
        expect((await dashboardController.handle(request('/dash/admin/patients/', IUserRoleEnum.ADMIN))).status).toBe(403);
        expect(list).not.toHaveBeenCalled();

        findAdmin.mockReturnValue(query(adminProfile([IAdminPermissionEnum.MANAGE_PATIENTS])) as never);
        expect((await dashboardController.handle(request('/dash/admin/patients/', IUserRoleEnum.ADMIN))).status).toBe(200);

        findAdmin.mockReturnValue(query(adminProfile([], true)) as never);
        expect((await dashboardController.handle(request('/dash/admin/patients/', IUserRoleEnum.ADMIN))).status).toBe(200);
    });

    test('activity logs require view_audit_logs with Super Admin bypass', async () => {
        const findAdmin = spyOn(Admin, 'findOne').mockReturnValue(query(adminProfile()) as never);
        const list = spyOn(activityLogService, 'getPaginated').mockResolvedValue({ data: [], count: 0 } as never);
        expect((await dashboardController.handle(request('/dash/admin/activity-logs/', IUserRoleEnum.ADMIN))).status).toBe(403);
        expect(list).not.toHaveBeenCalled();

        findAdmin.mockReturnValue(query(adminProfile([IAdminPermissionEnum.VIEW_AUDIT_LOGS])) as never);
        expect((await dashboardController.handle(request('/dash/admin/activity-logs/', IUserRoleEnum.ADMIN))).status).toBe(200);

        findAdmin.mockReturnValue(query(adminProfile([], true)) as never);
        expect((await dashboardController.handle(request('/dash/admin/activity-logs/', IUserRoleEnum.ADMIN))).status).toBe(200);
    });

    test('doctor verification uses verify_doctors instead of manage_doctors', async () => {
        const findAdmin = spyOn(Admin, 'findOne').mockReturnValue(query(adminProfile([IAdminPermissionEnum.MANAGE_DOCTORS])) as never);
        const lookup = spyOn(doctorService, 'getById').mockResolvedValue(null);
        const body = { verification_status: 'verified' };
        expect((await dashboardController.handle(request(`/dash/admin/doctors/${objectId}/verification`, IUserRoleEnum.ADMIN, 'PATCH', body))).status).toBe(403);
        expect(lookup).not.toHaveBeenCalled();

        findAdmin.mockReturnValue(query(adminProfile([IAdminPermissionEnum.VERIFY_DOCTORS])) as never);
        expect((await dashboardController.handle(request(`/dash/admin/doctors/${objectId}/verification`, IUserRoleEnum.ADMIN, 'PATCH', body))).status).toBe(404);
        expect(lookup).toHaveBeenCalled();
    });

    test('auth-security keeps its explicit permissions and rejects other roles at the namespace', async () => {
        const findAdmin = spyOn(Admin, 'findOne').mockReturnValue(query(adminProfile()) as never);
        const list = spyOn(authEventService, 'list').mockResolvedValue({ data: [], count: 0, page: 1, limit: 20 });
        expect((await dashboardController.handle(request('/dash/admin/auth-security/events', IUserRoleEnum.PATIENT))).status).toBe(403);
        expect((await dashboardController.handle(request('/dash/admin/auth-security/events', IUserRoleEnum.ADMIN))).status).toBe(403);
        expect(list).not.toHaveBeenCalled();

        findAdmin.mockReturnValue(query(adminProfile([IAdminPermissionEnum.VIEW_AUTH_AUDIT])) as never);
        expect((await dashboardController.handle(request('/dash/admin/auth-security/events', IUserRoleEnum.ADMIN))).status).toBe(200);
    });

    test('every registered Admin GET requires some explicit permission for a normal employee', async () => {
        spyOn(Admin, 'findOne').mockReturnValue(query(adminProfile()) as never);
        const routes = dashboardController.routes.filter(route => route.method === 'GET' && route.path.startsWith('/dash/admin/'));
        for (const route of routes) {
            const response = await dashboardController.handle(request(materialize(route.path), IUserRoleEnum.ADMIN));
            expect(response.status, `${route.method} ${route.path}`).toBe(403);
        }
    });
});
