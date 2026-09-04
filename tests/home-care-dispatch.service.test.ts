import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import mongoose from 'mongoose';
import HomeCareRequest from '../src/models/home-care-request.model';
import nurseService from '../src/services/nurse.service';
import historyService from '../src/services/home-care-request-history.service';
import ActivityLogService from '../src/services/activity-log.service';
import { HomeCareDispatchService } from '../src/services/home-care-dispatch.service';
import { IHomeCareDispatchModeEnum, IHomeCareDispatchStatusEnum, IHomeCareRequestStatusEnum } from '../src/interfaces/home-care-request.interface';
import { HomeCareHistoryEventEnum } from '../src/interfaces/home-care-request-history.interface';

afterEach(() => mock.restore());
/** Unit-only transaction boundary; replica-set tests use a real ClientSession. */
beforeEach(() => {
    const session: any = { withTransaction: async (callback: any) => await callback(), endSession: async () => {} };
    spyOn(mongoose, 'startSession').mockResolvedValue(session);
});

const requestId = new mongoose.Types.ObjectId('507f191e810c19729de86101');
const serviceId = new mongoose.Types.ObjectId('507f191e810c19729de86102');
const nurseAId = new mongoose.Types.ObjectId('507f191e810c19729de86103');
const nurseBId = new mongoose.Types.ObjectId('507f191e810c19729de86104');
const userA = '507f191e810c19729de86105';
const userB = '507f191e810c19729de86106';
const adminId = '507f191e810c19729de86107';

function query<T>(result: T) {
    const chain: any = { exec: async () => result };
    for (const method of ['select', 'populate', 'sort', 'skip', 'limit', 'session']) chain[method] = () => chain;
    return chain;
}
function nurse(id = nurseAId, userId = userA, qualified = [serviceId]) {
    return { _id: id, user_id: new mongoose.Types.ObjectId(userId), full_name: 'ممرض', status: 'active', qualified_service_ids: qualified } as any;
}
function request(status: string = IHomeCareRequestStatusEnum.PENDING, nurseId: mongoose.Types.ObjectId | null = null, version = 0) {
    const doc: any = {
        _id: requestId, request_number: 'HC-2026-000001', service_id: serviceId,
        status, dispatch: { status: nurseId ? IHomeCareDispatchStatusEnum.CLAIMED : IHomeCareDispatchStatusEnum.OPEN, mode: IHomeCareDispatchModeEnum.OPEN_POOL, nurse_id: nurseId, version },
    };
    doc.toObject = () => ({ ...doc, toObject: undefined });
    return doc;
}
function actor(userId: string, type: 'nurse' | 'admin', nurseId?: string) { return { user_id: userId, user_type: type, nurse_id: nurseId, endpoint: '/test' }; }
function quietWrites() { spyOn(historyService, 'append').mockResolvedValue(); spyOn(ActivityLogService, 'logActivity').mockResolvedValue({} as never); }

describe('Home Care open-pool atomic claim', () => {
    test('available pool is restricted to active Nurse qualifications and claimable OPEN states', async () => {
        const service = new HomeCareDispatchService(); spyOn(nurseService, 'requireActiveByUserId').mockResolvedValue(nurse());
        const find = spyOn(HomeCareRequest, 'find').mockReturnValue(query([]) as never);
        spyOn(HomeCareRequest, 'countDocuments').mockReturnValue(query(0) as never);
        await service.listAvailable(userA, { page: 1, limit: 10 });
        const filter = (find.mock.calls as any)[0][0] as any;
        expect(filter.status.$in).toEqual(['pending', 'confirmed']);
        expect(filter.service_id.$in.map(String)).toEqual([String(serviceId)]);
        expect(filter.$and).toBeDefined();
    });

    test('my requests and detail are always scoped to the authenticated Nurse id', async () => {
        const service = new HomeCareDispatchService(); spyOn(nurseService, 'requireActiveByUserId').mockResolvedValue(nurse());
        const find = spyOn(HomeCareRequest, 'find').mockReturnValue(query([]) as never); spyOn(HomeCareRequest, 'countDocuments').mockReturnValue(query(0) as never);
        await service.listMine(userA, { page: 1, limit: 10 });
        expect(((find.mock.calls as any)[0][0] as any)['dispatch.nurse_id']).toEqual(nurseAId);
        const findOne = spyOn(HomeCareRequest, 'findOne').mockReturnValue(query(null) as never);
        expect(await service.getMine(userA, String(requestId))).toBeNull();
        expect(findOne.mock.calls[0][0]).toMatchObject({ _id: String(requestId), 'dispatch.nurse_id': nurseAId });
    });

    for (const initial of [IHomeCareRequestStatusEnum.PENDING, IHomeCareRequestStatusEnum.CONFIRMED]) {
        test(`eligible Nurse atomically claims ${initial} and records the winner`, async () => {
            const service = new HomeCareDispatchService(), snapshot = request(initial), updated = request(IHomeCareRequestStatusEnum.ASSIGNED, nurseAId, 1);
            spyOn(nurseService, 'requireActiveByUserId').mockResolvedValue(nurse()); quietWrites();
            let reads = 0; spyOn(HomeCareRequest, 'findById').mockImplementation(() => query(reads++ === 0 ? snapshot : updated) as never);
            const update = spyOn(HomeCareRequest, 'findOneAndUpdate').mockReturnValue(query(updated) as never);
            const result = await service.claim(userA, String(requestId), actor(userA, 'nurse', String(nurseAId)));
            expect(result.status).toBe(IHomeCareRequestStatusEnum.ASSIGNED);
            const [filter, mutation] = update.mock.calls[0] as any;
            expect(filter.status.$in).toEqual(['pending', 'confirmed']);
            expect(filter.$and).toBeDefined();
            expect(mutation.$set['dispatch.mode']).toBe(IHomeCareDispatchModeEnum.OPEN_POOL);
            expect(String(mutation.$set['dispatch.nurse_id'])).toBe(String(nurseAId));
            expect(mutation.$inc['dispatch.version']).toBe(1);
            expect(historyService.append).toHaveBeenCalledTimes(1);
            expect((historyService.append as any).mock.calls[0][0].event_type).toBe(HomeCareHistoryEventEnum.CLAIMED_BY_NURSE);
        });
    }

    test('two simultaneous Nurse claims produce exactly one winner and one conflict', async () => {
        const service = new HomeCareDispatchService(), snapshot = request(), updated = request(IHomeCareRequestStatusEnum.ASSIGNED, nurseAId, 1);
        spyOn(nurseService, 'requireActiveByUserId').mockImplementation(async id => id === userA ? nurse() : nurse(nurseBId, userB));
        spyOn(HomeCareRequest, 'findById').mockReturnValue(query(snapshot) as never); quietWrites();
        let open = true;
        spyOn(HomeCareRequest, 'findOneAndUpdate').mockImplementation(() => query(open ? (open = false, updated) : null) as never);
        const results = await Promise.allSettled([
            service.claim(userA, String(requestId), actor(userA, 'nurse', String(nurseAId))),
            service.claim(userB, String(requestId), actor(userB, 'nurse', String(nurseBId))),
        ]);
        expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(item => item.status === 'rejected')).toHaveLength(1);
        expect((results.find(item => item.status === 'rejected') as PromiseRejectedResult).reason.status).toBe(409);
        expect(historyService.append).toHaveBeenCalledTimes(1);
    });

    test('Nurse claim and Admin direct assignment compete for one OPEN winner', async () => {
        const service = new HomeCareDispatchService(), snapshot = request(), updated = request(IHomeCareRequestStatusEnum.ASSIGNED, nurseAId, 1);
        spyOn(nurseService, 'requireActiveByUserId').mockResolvedValue(nurse());
        spyOn(nurseService, 'requireActiveQualified').mockResolvedValue(nurse(nurseBId, userB));
        spyOn(HomeCareRequest, 'findById').mockReturnValue(query(snapshot) as never); quietWrites();
        let open = true; spyOn(HomeCareRequest, 'findOneAndUpdate').mockImplementation(() => query(open ? (open = false, updated) : null) as never);
        const results = await Promise.allSettled([
            service.claim(userA, String(requestId), actor(userA, 'nurse', String(nurseAId))),
            service.assign(String(requestId), String(nurseBId), actor(adminId, 'admin')),
        ]);
        expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(item => item.status === 'rejected')).toHaveLength(1);
        expect((results.find(item => item.status === 'rejected') as PromiseRejectedResult).reason.status).toBe(409);
        expect(historyService.append).toHaveBeenCalledTimes(1);
    });

    test('unqualified Nurse is rejected before the atomic write', async () => {
        const service = new HomeCareDispatchService();
        spyOn(nurseService, 'requireActiveByUserId').mockResolvedValue(nurse(nurseAId, userA, []));
        spyOn(HomeCareRequest, 'findById').mockReturnValue(query(request()) as never);
        const update = spyOn(HomeCareRequest, 'findOneAndUpdate');
        await expect(service.claim(userA, String(requestId), actor(userA, 'nurse', String(nurseAId)))).rejects.toThrow('غير مؤهل');
        expect(update).not.toHaveBeenCalled();
    });
});

describe('Home Care lifecycle and Admin CAS operations', () => {
    test('allows only each owned Nurse lifecycle step and closes completion', async () => {
        const service = new HomeCareDispatchService(); spyOn(nurseService, 'requireActiveByUserId').mockResolvedValue(nurse()); quietWrites();
        const transitions = [
            ['assigned', 'on_the_way'], ['on_the_way', 'arrived'], ['arrived', 'in_progress'], ['in_progress', 'completed'],
        ] as const;
        for (const [from, to] of transitions) {
            const updated = request(to as any, nurseAId, 2);
            const update = spyOn(HomeCareRequest, 'findOneAndUpdate').mockReturnValue(query(updated) as never);
            spyOn(HomeCareRequest, 'findById').mockReturnValue(query(updated) as never);
            await service.transition(userA, String(requestId), from as any, to as any, actor(userA, 'nurse', String(nurseAId)));
            expect((update.mock.calls[0] as any)[0]).toMatchObject({ status: from, 'dispatch.nurse_id': nurseAId });
            if (to === 'completed') expect((update.mock.calls[0] as any)[1].$set['dispatch.status']).toBe('CLOSED');
            mock.restore(); spyOn(nurseService, 'requireActiveByUserId').mockResolvedValue(nurse()); quietWrites();
        }
    });

    test('stale lifecycle update loses after Admin changes current state', async () => {
        const service = new HomeCareDispatchService(); spyOn(nurseService, 'requireActiveByUserId').mockResolvedValue(nurse());
        spyOn(HomeCareRequest, 'findOneAndUpdate').mockReturnValue(query(null) as never);
        await expect(service.transition(userA, String(requestId), IHomeCareRequestStatusEnum.ASSIGNED, IHomeCareRequestStatusEnum.ON_THE_WAY, actor(userA, 'nurse', String(nurseAId)))).rejects.toMatchObject({ status: 409 });
    });

    test('Admin direct assignment competes on the same OPEN state', async () => {
        const service = new HomeCareDispatchService(), snapshot = request(), updated = request(IHomeCareRequestStatusEnum.ASSIGNED, nurseAId, 1);
        spyOn(HomeCareRequest, 'findById').mockReturnValue(query(snapshot) as never); spyOn(nurseService, 'requireActiveQualified').mockResolvedValue(nurse()); quietWrites();
        const update = spyOn(HomeCareRequest, 'findOneAndUpdate').mockReturnValue(query(updated) as never);
        await service.assign(String(requestId), String(nurseAId), actor(adminId, 'admin'));
        expect((update.mock.calls[0] as any)[0].$and).toBeDefined();
        expect((update.mock.calls[0] as any)[1].$set['dispatch.mode']).toBe(IHomeCareDispatchModeEnum.ADMIN_DIRECT);
    });

    test('Admin reassign resets to ASSIGNED and requires reason after dispatch begins', async () => {
        const service = new HomeCareDispatchService(), current = request(IHomeCareRequestStatusEnum.IN_PROGRESS, nurseAId, 4), updated = request(IHomeCareRequestStatusEnum.ASSIGNED, nurseBId, 5);
        spyOn(HomeCareRequest, 'findById').mockReturnValue(query(current) as never); spyOn(nurseService, 'requireActiveQualified').mockResolvedValue(nurse(nurseBId, userB));
        await expect(service.reassign(String(requestId), String(nurseBId), null, actor(adminId, 'admin'))).rejects.toThrow('مطلوب');
        quietWrites(); const update = spyOn(HomeCareRequest, 'findOneAndUpdate').mockReturnValue(query(updated) as never);
        await service.reassign(String(requestId), String(nurseBId), 'حالة تشغيلية', actor(adminId, 'admin'));
        expect((update.mock.calls[0] as any)[1].$set.status).toBe(IHomeCareRequestStatusEnum.ASSIGNED);
        expect((update.mock.calls[0] as any)[1].$set['dispatch.mode']).toBe(IHomeCareDispatchModeEnum.ADMIN_REASSIGN);
    });

    test('Admin unassign returns work to CONFIRMED OPEN pool and reopen rejects COMPLETED', async () => {
        const service = new HomeCareDispatchService(), current = request(IHomeCareRequestStatusEnum.ON_THE_WAY, nurseAId, 2), opened = request(IHomeCareRequestStatusEnum.CONFIRMED, null, 3);
        let reads = 0; spyOn(HomeCareRequest, 'findById').mockImplementation(() => query(reads++ === 0 ? current : opened) as never); quietWrites();
        const update = spyOn(HomeCareRequest, 'findOneAndUpdate').mockReturnValue(query(opened) as never);
        await service.unassign(String(requestId), 'إعادة إلى الحوض', actor(adminId, 'admin'));
        expect((update.mock.calls[0] as any)[1].$set).toMatchObject({ status: 'confirmed', 'dispatch.status': 'OPEN', 'dispatch.nurse_id': null });
        mock.restore(); spyOn(HomeCareRequest, 'findById').mockReturnValue(query(request(IHomeCareRequestStatusEnum.COMPLETED, nurseAId)) as never);
        await expect(service.reopen(String(requestId), 'تصحيح', actor(adminId, 'admin'))).rejects.toThrow('لا يمكن');
    });
});
