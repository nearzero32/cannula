import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import mongoose from 'mongoose';
import HomeCareRequest from '../src/models/home-care-request.model';
import HomeCareRequestCounter from '../src/models/home-care-request-counter.model';
import homeCareServiceService from '../src/services/home-care-service.service';
import patientChildService from '../src/services/patient-child.service';
import ActivityLogService from '../src/services/activity-log.service';
import homeCareRequestHistoryService from '../src/services/home-care-request-history.service';
import {
    HomeCareRequestService,
    nextHomeCareRequestNumber,
    type HomeCareRequestCreateInput,
} from '../src/services/home-care-request.service';
import { PatientChildStatusEnum } from '../src/interfaces/patient-child.interface';
import { IHomeCareRequestStatusEnum } from '../src/interfaces/home-care-request.interface';

afterEach(() => mock.restore());
beforeEach(() => {
    const session: any = { withTransaction: async (work: any) => work(), endSession: async () => {} };
    spyOn(mongoose, 'startSession').mockResolvedValue(session);
});

const patientId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');
const childId = new mongoose.Types.ObjectId('507f191e810c19729de860ea');
const serviceId = new mongoose.Types.ObjectId('507f191e810c19729de860eb');
const categoryId = new mongoose.Types.ObjectId('507f191e810c19729de860ec');
const userId = '507f191e810c19729de860ed';
const actor = {
    user_id: userId,
    user_type: 'patient' as const,
    endpoint: '/mobile/home-care/requests',
    source: 'mobile' as const,
};
const input: HomeCareRequestCreateInput = {
    service_id: serviceId.toString(),
    requested_date: '2099-09-02',
    preferred_time: '09:00',
    address: { address_text: 'بغداد - المنصور', lat: 33.3152, lng: 44.3661 },
    notes: 'اتصل قبل الوصول',
};

function serviceDocument(overrides: Record<string, unknown> = {}) {
    return {
        _id: serviceId,
        category_id: categoryId,
        name: 'تمريض منزلي',
        price: 15000,
        duration_min: 30,
        duration_max: 60,
        ...overrides,
    };
}

function requestDocument(overrides: Record<string, unknown> = {}) {
    const now = new Date('2026-08-31T12:00:00.000Z');
    const document: any = {
        _id: new mongoose.Types.ObjectId('507f191e810c19729de860ef'),
        request_number: 'HC-2099-000001',
        patient_id: patientId,
        child_id: null,
        category_id: categoryId,
        service_id: serviceId,
        service_name: 'تمريض منزلي',
        service_price: 15000,
        service_duration_min: 30,
        service_duration_max: 60,
        requested_date: new Date('2099-09-02T00:00:00.000Z'),
        preferred_time: '09:00',
        address: input.address,
        notes: input.notes,
        status: IHomeCareRequestStatusEnum.PENDING,
        internal_notes: null,
        cancelled_at: null,
        cancelled_by: null,
        cancellation_reason: null,
        dispatch: { status: 'OPEN', mode: 'OPEN_POOL', nurse_id: null, version: 0 },
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
    document.toObject = () => ({ ...document, toObject: undefined });
    return document;
}

function mockCounter(start = 0) {
    let sequence = start;
    return spyOn(HomeCareRequestCounter, 'findOneAndUpdate').mockImplementation((filter, update, options) => ({
        session: () => ({ exec: async () => ({ sequence: ++sequence, filter, update, options }) }),
        exec: async () => ({ sequence: ++sequence, filter, update, options }),
    }) as never);
}
function sessionQuery(value: unknown) { return { session: () => ({ exec: async () => value }) }; }

function mockCreateFoundation(requestService: HomeCareRequestService) {
    spyOn(homeCareServiceService, 'getActiveById').mockResolvedValue(serviceDocument() as never);
    mockCounter();
    spyOn(ActivityLogService, 'logActivity').mockResolvedValue({} as never);
    spyOn(homeCareRequestHistoryService, 'append').mockResolvedValue();
    spyOn(requestService, 'getForPatient').mockResolvedValue(null);
}

describe('Home Care request creation', () => {
    test('rejects invalid and unavailable services', async () => {
        const requestService = new HomeCareRequestService();
        await expect(requestService.createForPatient(patientId, { ...input, service_id: 'bad' }, actor))
            .rejects.toThrow('معرف الخدمة غير صالح');
        spyOn(homeCareServiceService, 'getActiveById').mockResolvedValue(null);
        await expect(requestService.createForPatient(patientId, input, actor))
            .rejects.toThrow('غير موجودة أو غير متاحة');
    });

    test('creates a SELF request with server-owned snapshot and status', async () => {
        const requestService = new HomeCareRequestService();
        mockCreateFoundation(requestService);
        let createdPayload: any;
        spyOn(HomeCareRequest, 'create').mockImplementation((async (payload: any) => {
            createdPayload = (payload as any)[0]; return [requestDocument(createdPayload)];
        }) as never);

        const result = await requestService.createForPatient(patientId, input, actor);
        expect(result.request_number).toMatch(/^HC-\d{4}-000001$/);
        expect(createdPayload.patient_id).toEqual(patientId);
        expect(createdPayload.child_id).toBeNull();
        expect(createdPayload.service_name).toBe('تمريض منزلي');
        expect(createdPayload.service_price).toBe(15000);
        expect(createdPayload.service_duration_min).toBe(30);
        expect(createdPayload.status).toBe(IHomeCareRequestStatusEnum.PENDING);
        expect(createdPayload.dispatch).toMatchObject({ status: 'OPEN', mode: 'OPEN_POOL', nurse_id: null, version: 0 });
        expect(createdPayload.internal_notes).toBeNull();
        expect(homeCareRequestHistoryService.append).toHaveBeenCalledTimes(1);
        expect((homeCareRequestHistoryService.append as any).mock.calls[0][0].event_type).toBe('REQUEST_CREATED');
    });

    test('creates a CHILD request only for an owned active child', async () => {
        const requestService = new HomeCareRequestService();
        mockCreateFoundation(requestService);
        const owned = spyOn(patientChildService, 'requireOwnedChild').mockResolvedValue({
            _id: childId,
            status: PatientChildStatusEnum.ACTIVE,
        } as never);
        let createdPayload: any;
        spyOn(HomeCareRequest, 'create').mockImplementation((async (payload: any) => {
            createdPayload = (payload as any)[0]; return [requestDocument(createdPayload)];
        }) as never);

        await requestService.createForPatient(patientId, { ...input, child_id: childId.toString() }, actor);
        expect(owned).toHaveBeenCalledWith(patientId, childId.toString());
        expect(createdPayload.child_id.toString()).toBe(childId.toString());
    });

    test('rejects an invalid child identifier when supplied', async () => {
        const requestService = new HomeCareRequestService();
        spyOn(homeCareServiceService, 'getActiveById').mockResolvedValue(serviceDocument() as never);
        await expect(requestService.createForPatient(
            patientId,
            { ...input, child_id: '' },
            actor
        )).rejects.toThrow('معرف الطفل غير صالح');
    });

    test('rejects another patient child and inactive children', async () => {
        const foreignService = new HomeCareRequestService();
        spyOn(homeCareServiceService, 'getActiveById').mockResolvedValue(serviceDocument() as never);
        spyOn(patientChildService, 'requireOwnedChild').mockRejectedValue(new Error('الطفل غير موجود'));
        await expect(foreignService.createForPatient(
            patientId,
            { ...input, child_id: childId.toString() },
            actor
        )).rejects.toThrow('الطفل غير موجود');

        mock.restore();
        const inactiveService = new HomeCareRequestService();
        spyOn(homeCareServiceService, 'getActiveById').mockResolvedValue(serviceDocument() as never);
        spyOn(patientChildService, 'requireOwnedChild').mockResolvedValue({
            _id: childId,
            status: PatientChildStatusEnum.INACTIVE,
        } as never);
        await expect(inactiveService.createForPatient(
            patientId,
            { ...input, child_id: childId.toString() },
            actor
        )).rejects.toThrow('غير فعال');
    });

    test('allocates unique numbers with an atomic yearly $inc counter', async () => {
        const counter = mockCounter(40);
        const numbers = await Promise.all(
            Array.from({ length: 20 }, () => nextHomeCareRequestNumber(new Date('2026-01-01T00:00:00Z')))
        );
        expect(new Set(numbers).size).toBe(20);
        expect(numbers[0]).toBe('HC-2026-000041');
        expect(numbers[19]).toBe('HC-2026-000060');
        for (const call of counter.mock.calls) {
            expect(call[1]).toEqual({ $inc: { sequence: 1 } });
            expect(call[2]).toMatchObject({ upsert: true, returnDocument: 'after' });
        }
    });
});

describe('Home Care patient ownership and cancellation', () => {
    test('patient listing always scopes by authenticated patient', async () => {
        const chain: any = {
            populate: () => chain,
            sort: () => chain,
            skip: () => chain,
            limit: () => chain,
            exec: async () => [],
        };
        const find = spyOn(HomeCareRequest, 'find').mockReturnValue(chain);
        spyOn(HomeCareRequest, 'countDocuments').mockReturnValue({ exec: async () => 0 } as never);
        const result = await new HomeCareRequestService().listForPatient(patientId, { page: 2, limit: 5 });
        expect(find).toHaveBeenCalledWith({ patient_id: patientId });
        expect(result).toEqual({ data: [], count: 0 });
    });

    test('patient detail lookup hides another patient request as not found', async () => {
        const chain: any = { populate: () => chain, exec: async () => null };
        const findOne = spyOn(HomeCareRequest, 'findOne').mockReturnValue(chain);
        expect(await new HomeCareRequestService().getForPatient(
            patientId,
            '507f191e810c19729de860ef'
        )).toBeNull();
        expect(findOne).toHaveBeenCalledWith({
            _id: '507f191e810c19729de860ef',
            patient_id: patientId,
        });
    });

    for (const status of [IHomeCareRequestStatusEnum.PENDING, IHomeCareRequestStatusEnum.CONFIRMED]) {
        test(`patient can cancel ${status}`, async () => {
            const requestService = new HomeCareRequestService();
            const current = requestDocument({ status });
            const updated = requestDocument({ status: IHomeCareRequestStatusEnum.CANCELLED });
            spyOn(HomeCareRequest, 'findOne').mockReturnValue(sessionQuery(current) as never);
            spyOn(requestService, 'getForPatient').mockResolvedValue(updated);
            const update = spyOn(HomeCareRequest, 'findOneAndUpdate').mockReturnValue({
                exec: async () => updated,
            } as never);
            spyOn(ActivityLogService, 'logActivity').mockResolvedValue({} as never);
            spyOn(homeCareRequestHistoryService, 'append').mockResolvedValue();

            const result = await requestService.cancelForPatient(
                patientId,
                current._id.toString(),
                'تغيرت الخطة',
                actor
            );
            expect(result.status).toBe(IHomeCareRequestStatusEnum.CANCELLED);
            expect(update.mock.calls[0][1]).toMatchObject({
                $set: {
                    status: IHomeCareRequestStatusEnum.CANCELLED,
                    cancellation_reason: 'تغيرت الخطة',
                },
            });
        });
    }

    test('patient cannot cancel an in-progress request', async () => {
        const requestService = new HomeCareRequestService();
        spyOn(HomeCareRequest, 'findOne').mockReturnValue(sessionQuery(null) as never);
        const update = spyOn(HomeCareRequest, 'findOneAndUpdate');
        await expect(requestService.cancelForPatient(
            patientId,
            '507f191e810c19729de860ef',
            null,
            actor
        )).rejects.toThrow('لا يمكنك إلغاء');
        expect(update).not.toHaveBeenCalled();
    });
});

describe('Home Care dashboard request operations', () => {
    const adminActor = {
        user_id: userId,
        user_type: 'admin' as const,
        endpoint: '/dash/admin/home-care/requests/id/status',
        source: 'dashboard' as const,
    };

    test('applies an allowed status transition with an atomic current-status filter', async () => {
        const requestService = new HomeCareRequestService();
        const current = requestDocument({ status: IHomeCareRequestStatusEnum.PENDING });
        const updated = requestDocument({ status: IHomeCareRequestStatusEnum.CONFIRMED });
        spyOn(HomeCareRequest, 'findById').mockReturnValue(sessionQuery(current) as never);
        spyOn(requestService, 'getForDashboard').mockResolvedValue(updated);
        const update = spyOn(HomeCareRequest, 'findOneAndUpdate').mockReturnValue({
            exec: async () => updated,
        } as never);
        spyOn(ActivityLogService, 'logActivity').mockResolvedValue({} as never);
        spyOn(homeCareRequestHistoryService, 'append').mockResolvedValue();

        const result = await requestService.updateStatus(
            current._id.toString(),
            IHomeCareRequestStatusEnum.CONFIRMED,
            adminActor
        );
        expect(result.status).toBe(IHomeCareRequestStatusEnum.CONFIRMED);
        expect(update.mock.calls[0][0]).toEqual({
            _id: current._id,
            status: IHomeCareRequestStatusEnum.PENDING,
            'dispatch.status': 'OPEN',
            'dispatch.nurse_id': null,
        });
    });

    test('rejects forbidden dashboard transitions before persistence', async () => {
        const requestService = new HomeCareRequestService();
        spyOn(requestService, 'getForDashboard').mockResolvedValue(requestDocument({
            status: IHomeCareRequestStatusEnum.PENDING,
        }));
        const update = spyOn(HomeCareRequest, 'findOneAndUpdate');
        await expect(requestService.updateStatus(
            '507f191e810c19729de860ef',
            IHomeCareRequestStatusEnum.COMPLETED,
            adminActor
        )).rejects.toThrow('تأكيد الطلب فقط');
        expect(update).not.toHaveBeenCalled();
    });

    test('admin cancellation records actor type and reason', async () => {
        const requestService = new HomeCareRequestService();
        const current = requestDocument({ status: IHomeCareRequestStatusEnum.CONFIRMED });
        const updated = requestDocument({ status: IHomeCareRequestStatusEnum.CANCELLED });
        spyOn(HomeCareRequest, 'findById').mockReturnValue(sessionQuery(current) as never);
        spyOn(requestService, 'getForDashboard').mockResolvedValue(updated);
        const update = spyOn(HomeCareRequest, 'findOneAndUpdate').mockReturnValue({
            exec: async () => updated,
        } as never);
        spyOn(ActivityLogService, 'logActivity').mockResolvedValue({} as never);
        spyOn(homeCareRequestHistoryService, 'append').mockResolvedValue();

        await requestService.cancelForAdmin(
            current._id.toString(),
            'تعذر تقديم الخدمة',
            adminActor
        );
        expect(update.mock.calls[0][1]).toMatchObject({
            $set: {
                status: IHomeCareRequestStatusEnum.CANCELLED,
                cancelled_by: { id: new mongoose.Types.ObjectId(userId), type: 'ADMIN' },
                cancellation_reason: 'تعذر تقديم الخدمة',
            },
        });
    });
});
