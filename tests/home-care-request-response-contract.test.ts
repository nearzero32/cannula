import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import mongoose from 'mongoose';
import { Value } from '@sinclair/typebox/value';
import { mobileHomeCareRequestsController } from '../src/controller/mobile/home-care-requests.controller';
import { homeCareRequestsAdminController } from '../src/controller/dash/admin/home-care-requests.controller';
import homeCareRequestService from '../src/services/home-care-request.service';
import homeCarePolicyService from '../src/services/home-care-policy.service';
import patientService from '../src/services/patient.service';
import { signAccessToken, TokenAudienceEnum } from '../src/constants/jwt';
import sessionService from '../src/services/session.service';
import { IUserRoleEnum } from '../src/interfaces/user.interface';
import { IHomeCareRequestStatusEnum } from '../src/interfaces/home-care-request.interface';
import Admin from '../src/models/admins.model';
import { IAdminPermissionEnum } from '../src/interfaces/admin.interface';
import {
    DashboardHomeCareRequestListResponseSchema,
    DashboardHomeCareRequestResponseSchema,
    MobileHomeCareRequestListResponseSchema,
    MobileHomeCareRequestResponseSchema,
} from '../src/schemas/home-care-request-response.schema';
import {
    NotFoundResponseSchema,
    ValidationErrorResponseSchema,
} from '../src/schemas/api-response.schema';

const userId = '507f1f77bcf86cd799439011';
const patientId = new mongoose.Types.ObjectId('507f191e810c19729de860e1');
const requestId = new mongoose.Types.ObjectId('507f191e810c19729de860e2');
const query = <T>(value: T) => ({ select() { return this; }, lean() { return this; }, exec: async () => value });

function requestDocument(overrides: Record<string, unknown> = {}) {
    const now = new Date('2026-08-31T12:00:00.000Z');
    return {
        _id: requestId,
        request_number: 'HC-2026-000123',
        patient_id: {
            _id: patientId,
            full_name: 'مريض تجريبي',
            phone: '07700000000',
            profile_photo: null,
        },
        child_id: null,
        category_id: new mongoose.Types.ObjectId('507f191e810c19729de860e3'),
        service_id: new mongoose.Types.ObjectId('507f191e810c19729de860e4'),
        service_name: 'تمريض منزلي',
        service_price: 15000,
        service_duration_min: 30,
        service_duration_max: 60,
        requested_date: new Date('2026-09-02T00:00:00.000Z'),
        preferred_time: '09:00',
        address: { address_text: 'بغداد - المنصور', lat: 33.3152, lng: 44.3661 },
        notes: null,
        status: IHomeCareRequestStatusEnum.PENDING,
        internal_notes: null,
        cancelled_at: null,
        cancelled_by: null,
        cancellation_reason: null,
        createdAt: now,
        updatedAt: now,
        ...overrides,
    } as never;
}

function authorizedRequest(path: string, role: 'patient' | 'admin', init?: RequestInit) {
    const audience = role === IUserRoleEnum.PATIENT ? TokenAudienceEnum.MOBILE : TokenAudienceEnum.DASHBOARD;
    const token = signAccessToken({ _id: userId, role, sid: '12345678-1234-4234-8234-123456789012', audience });
    const headers = new Headers(init?.headers);
    headers.set('authorization', `Bearer ${token}`);
    if (init?.body) headers.set('content-type', 'application/json');
    return new Request(`http://localhost${path}`, { ...init, headers });
}

async function body(response: Response) {
    return await response.json() as Record<string, unknown>;
}

beforeEach(() => {
    spyOn(sessionService, 'validateAccess').mockImplementation(async payload => ({ sid: payload.sid, userId: payload._id, role: payload.role, audience: payload.aud, restricted: false, currentRefreshDigest: 'hash', createdAt: '', lastSeenAt: '', lastRefreshedAt: '', expiresAt: '' }));
    spyOn(Admin, 'findOne').mockReturnValue(query({ is_active: true, super_admin: false, permissions: [IAdminPermissionEnum.MANAGE_HOME_CARE] }) as never);
});

afterEach(() => mock.restore());

describe('Mobile Home Care request response contracts', () => {
    test('create response uses the typed contract and ignores no trusted client fields', async () => {
        spyOn(patientService, 'getByUserId').mockResolvedValue({ _id: patientId } as never);
        const create = spyOn(homeCareRequestService, 'createForPatient').mockResolvedValue(requestDocument());
        const response = await mobileHomeCareRequestsController.handle(authorizedRequest(
            '/home-care/requests/',
            IUserRoleEnum.PATIENT,
            {
                method: 'POST',
                body: JSON.stringify({
                    service_id: '507f191e810c19729de860e4',
                    child_id: null,
                    requested_date: '2026-09-02',
                    preferred_time: '09:00',
                    address: { address_text: 'بغداد - المنصور', lat: 33.3152, lng: 44.3661 },
                    notes: null,
                }),
            }
        ));
        const json = await body(response);
        expect(response.status).toBe(201);
        expect(Value.Check(MobileHomeCareRequestResponseSchema, json)).toBe(true);
        expect(create.mock.calls[0][0].toString()).toBe(patientId.toString());
        expect((json.data as any).service.price).toBe(15000);
        expect(JSON.stringify(json)).not.toContain('internal_notes');
    });

    test('patient_id, price, status and internal notes cannot reach request creation', async () => {
        spyOn(patientService, 'getByUserId').mockResolvedValue({ _id: patientId } as never);
        const create = spyOn(homeCareRequestService, 'createForPatient').mockResolvedValue(requestDocument());
        const response = await mobileHomeCareRequestsController.handle(authorizedRequest(
            '/home-care/requests/',
            IUserRoleEnum.PATIENT,
            {
                method: 'POST',
                body: JSON.stringify({
                    service_id: '507f191e810c19729de860e4',
                    requested_date: '2026-09-02',
                    preferred_time: '09:00',
                    address: { address_text: 'بغداد - المنصور', lat: 33.3, lng: 44.3 },
                    patient_id: patientId.toString(),
                    price: 1,
                    status: 'completed',
                    internal_notes: 'unsafe',
                }),
            }
        ));
        expect(response.status).toBe(201);
        const trustedInput = create.mock.calls[0][1] as unknown as Record<string, unknown>;
        expect(trustedInput.patient_id).toBeUndefined();
        expect(trustedInput.price).toBeUndefined();
        expect(trustedInput.status).toBeUndefined();
        expect(trustedInput.internal_notes).toBeUndefined();
    });

    test('list returns the required pagination shape and only service-scoped data', async () => {
        spyOn(patientService, 'getByUserId').mockResolvedValue({ _id: patientId } as never);
        const list = spyOn(homeCareRequestService, 'listForPatient').mockResolvedValue({
            data: [requestDocument()], count: 11,
        });
        const response = await mobileHomeCareRequestsController.handle(authorizedRequest(
            '/home-care/requests/?page=2&limit=5&status=pending',
            IUserRoleEnum.PATIENT
        ));
        const json = await body(response);
        expect(response.status).toBe(200);
        expect(Value.Check(MobileHomeCareRequestListResponseSchema, json)).toBe(true);
        expect(json.pagination).toEqual({
            page: 2, limit: 5, total: 11, pages: 3, hasNext: true, hasPrev: true,
        });
        expect(list.mock.calls[0][0].toString()).toBe(patientId.toString());
    });

    test('another patient request is indistinguishable from a missing request', async () => {
        spyOn(patientService, 'getByUserId').mockResolvedValue({ _id: patientId } as never);
        spyOn(homeCareRequestService, 'getForPatient').mockResolvedValue(null);
        const response = await mobileHomeCareRequestsController.handle(authorizedRequest(
            `/home-care/requests/${requestId}`,
            IUserRoleEnum.PATIENT
        ));
        expect(response.status).toBe(404);
        expect(Value.Check(NotFoundResponseSchema, await body(response))).toBe(true);
    });
});

describe('Dashboard Home Care request response contracts', () => {
    test('active normal admin can list operational requests with pagination', async () => {
        spyOn(homeCarePolicyService, 'getAccess').mockResolvedValue('manage');
        spyOn(homeCareRequestService, 'listForDashboard').mockResolvedValue({
            data: [requestDocument()], count: 1,
        });
        const response = await homeCareRequestsAdminController.handle(authorizedRequest(
            '/requests/?status=pending',
            IUserRoleEnum.ADMIN
        ));
        const json = await body(response);
        expect(response.status).toBe(200);
        expect(Value.Check(DashboardHomeCareRequestListResponseSchema, json)).toBe(true);
        expect((json.data as any[])[0].patient.full_name).toBe('مريض تجريبي');
    });

    test('status update and internal note responses match dashboard contracts', async () => {
        spyOn(homeCarePolicyService, 'getAccess').mockResolvedValue('manage');
        spyOn(homeCareRequestService, 'updateStatus').mockResolvedValue(requestDocument({
            status: IHomeCareRequestStatusEnum.CONFIRMED,
        }));
        const statusResponse = await homeCareRequestsAdminController.handle(authorizedRequest(
            `/requests/${requestId}/status`,
            IUserRoleEnum.ADMIN,
            { method: 'PATCH', body: JSON.stringify({ status: 'confirmed' }) }
        ));
        expect(statusResponse.status).toBe(200);
        expect(Value.Check(DashboardHomeCareRequestResponseSchema, await body(statusResponse))).toBe(true);

        mock.restore();
        spyOn(sessionService, 'validateAccess').mockImplementation(async payload => ({ sid: payload.sid, userId: payload._id, role: payload.role, audience: payload.aud, restricted: false, currentRefreshDigest: 'hash', createdAt: '', lastSeenAt: '', lastRefreshedAt: '', expiresAt: '' }));
        spyOn(Admin, 'findOne').mockReturnValue(query({ is_active: true, super_admin: false, permissions: [IAdminPermissionEnum.MANAGE_HOME_CARE] }) as never);
        spyOn(homeCarePolicyService, 'getAccess').mockResolvedValue('manage');
        spyOn(homeCareRequestService, 'updateInternalNote').mockResolvedValue(requestDocument({
            internal_notes: 'تم التواصل مع المريض',
        }));
        const noteResponse = await homeCareRequestsAdminController.handle(authorizedRequest(
            `/requests/${requestId}/internal-note`,
            IUserRoleEnum.ADMIN,
            { method: 'PATCH', body: JSON.stringify({ internal_notes: 'تم التواصل مع المريض' }) }
        ));
        const noteJson = await body(noteResponse);
        expect(noteResponse.status).toBe(200);
        expect(Value.Check(DashboardHomeCareRequestResponseSchema, noteJson)).toBe(true);
        expect((noteJson.data as any).internal_notes).toBe('تم التواصل مع المريض');
    });
});
