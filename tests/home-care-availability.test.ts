import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import mongoose from 'mongoose';
import HomeCareService from '../src/models/home-care-service.model';
import HomeCareAvailabilitySlot from '../src/models/home-care-availability-slot.model';
import homeCareServiceService from '../src/services/home-care-service.service';
import ActivityLogService from '../src/services/activity-log.service';
import { HomeCareAvailabilityService, HOME_CARE_MAX_AVAILABILITY_SLOTS } from '../src/services/home-care-availability.service';
import { homeCareSlotMeetsLeadTime } from '../src/services/home-care-date.service';
import { IHomeCareStatusEnum } from '../src/interfaces/home-care.interface';

const serviceId = new mongoose.Types.ObjectId('507f191e810c19729de86101');
const otherServiceId = new mongoose.Types.ObjectId('507f191e810c19729de86102');
const slotId = new mongoose.Types.ObjectId('507f191e810c19729de86103');
const actor = { user_id: '507f191e810c19729de86104', user_type: 'admin', source: 'dashboard' };
const dates = { createdAt: new Date('2026-09-07T00:00:00Z'), updatedAt: new Date('2026-09-07T00:00:00Z') };
const slot = (overrides: any = {}) => ({ _id: slotId, service_id: serviceId, time: '11:00', status: 'active', display_order: 10, created_by: actor.user_id, ...dates, toObject() { return { ...this, toObject: undefined }; }, ...overrides });
const execQuery = (value: any) => ({ exec: async () => value, select() { return this; }, lean() { return this; }, session() { return this; }, sort() { return this; } });

beforeEach(() => { spyOn(ActivityLogService, 'logActivity').mockResolvedValue({} as never); });
afterEach(() => mock.restore());

describe('Home Care availability domain', () => {
    test('model has per-service uniqueness and mobile ordering indexes', () => {
        const indexes = HomeCareAvailabilitySlot.schema.indexes();
        expect(indexes.some(([keys, options]) => keys.service_id === 1 && keys.time === 1 && options.unique === true)).toBe(true);
        expect(indexes.some(([keys]) => keys.service_id === 1 && keys.status === 1 && keys.display_order === 1)).toBe(true);
    });

    test('creates and dashboard-lists slots with service ownership', async () => {
        spyOn(HomeCareService, 'findById').mockReturnValue(execQuery({ _id: serviceId }) as never);
        spyOn(HomeCareAvailabilitySlot, 'countDocuments').mockResolvedValue(0 as never);
        const create = spyOn(HomeCareAvailabilitySlot, 'create').mockResolvedValue(slot() as never);
        const service = new HomeCareAvailabilityService();
        expect((await service.create(String(serviceId), { time: '11:00', display_order: 10 }, actor)).time).toBe('11:00');
        expect(create.mock.calls[0]![0]).toMatchObject({ service_id: String(serviceId), time: '11:00', status: 'active', display_order: 10 });
        const find = spyOn(HomeCareAvailabilitySlot, 'find').mockReturnValue(execQuery([slot()]) as never);
        expect(await service.listForDashboard(String(serviceId))).toHaveLength(1);
        expect(find).toHaveBeenCalledWith({ service_id: String(serviceId) });
    });

    test('rejects duplicate time, invalid time, and slot-count abuse', async () => {
        spyOn(HomeCareService, 'findById').mockReturnValue(execQuery({ _id: serviceId }) as never);
        const service = new HomeCareAvailabilityService();
        spyOn(HomeCareAvailabilitySlot, 'countDocuments').mockResolvedValue(0 as never);
        spyOn(HomeCareAvailabilitySlot, 'create').mockRejectedValue({ code: 11000 } as never);
        await expect(service.create(String(serviceId), { time: '11:00' }, actor)).rejects.toMatchObject({ status: 409, code: 'HOME_CARE_SLOT_DUPLICATE' });
        await expect(service.create(String(serviceId), { time: '25:00' }, actor)).rejects.toMatchObject({ status: 400 });
        (HomeCareAvailabilitySlot.countDocuments as any).mockResolvedValue(HOME_CARE_MAX_AVAILABILITY_SLOTS);
        await expect(service.create(String(serviceId), { time: '12:00' }, actor)).rejects.toMatchObject({ code: 'HOME_CARE_SLOT_LIMIT' });
    });

    test('edits, disables, and soft-deletes only service-owned slots', async () => {
        spyOn(HomeCareService, 'findById').mockReturnValue(execQuery({ _id: serviceId }) as never);
        let findCalls = 0;
        spyOn(HomeCareAvailabilitySlot, 'findOne').mockImplementation(() => execQuery(++findCalls === 3 ? null : slot()) as never);
        const session: any = { withTransaction: async (work: any) => work(), endSession: async () => {} };
        spyOn(mongoose, 'startSession').mockResolvedValue(session);
        spyOn(HomeCareAvailabilitySlot, 'updateOne').mockResolvedValue({ modifiedCount: 1 } as never);
        spyOn(HomeCareAvailabilitySlot, 'create').mockResolvedValue([slot({ _id: new mongoose.Types.ObjectId(), time: '14:00', display_order: 30 })] as never);
        const update = spyOn(HomeCareAvailabilitySlot, 'findOneAndUpdate').mockImplementation((_filter, value) => execQuery(slot({ ...(value as any).$set })) as never);
        const service = new HomeCareAvailabilityService();
        expect((await service.update(String(serviceId), String(slotId), { time: '14:00', display_order: 30 }, actor)).time).toBe('14:00');
        expect((await service.updateStatus(String(serviceId), String(slotId), IHomeCareStatusEnum.INACTIVE, actor)).status).toBe('inactive');
        expect((await service.archive(String(serviceId), String(slotId), actor)).status).toBe('inactive');
        expect(update.mock.calls.every(call => (call[0] as any).service_id === String(serviceId))).toBe(true);
    });

    test('bulk replacement validates duplicates and atomically orders/deactivates', async () => {
        spyOn(HomeCareService, 'findById').mockReturnValue(execQuery({ _id: serviceId }) as never);
        const service = new HomeCareAvailabilityService();
        await expect(service.replace(String(serviceId), ['09:00', '09:00'], actor)).rejects.toMatchObject({ code: 'HOME_CARE_SLOT_DUPLICATE' });
        const session: any = { withTransaction: async (work: any) => work(), endSession: async () => {} };
        spyOn(mongoose, 'startSession').mockResolvedValue(session);
        let findCalls = 0;
        spyOn(HomeCareAvailabilitySlot, 'find').mockImplementation(() => {
            findCalls++;
            return execQuery(findCalls === 1 ? [slot()] : [slot({ time: '09:00', display_order: 10 }), slot({ _id: new mongoose.Types.ObjectId(), time: '14:00', display_order: 20 })]) as never;
        });
        spyOn(HomeCareAvailabilitySlot, 'updateMany').mockResolvedValue({ modifiedCount: 1 } as never);
        const bulk = spyOn(HomeCareAvailabilitySlot, 'bulkWrite').mockResolvedValue({ matchedCount: 1, upsertedCount: 1 } as never);
        const result = await service.replace(String(serviceId), ['09:00', '14:00'], actor);
        expect(result).toHaveLength(2);
        expect((bulk.mock.calls[0]![0] as any[]).map(x => x.updateOne.update.$set.display_order)).toEqual([10, 20]);
    });

    test('mobile list requires visible service, selects ACTIVE rows, and filters same-day lead time', async () => {
        spyOn(homeCareServiceService, 'getActiveById').mockResolvedValue({ _id: serviceId } as never);
        const find = spyOn(HomeCareAvailabilitySlot, 'find').mockReturnValue(execQuery([
            slot({ time: '09:00', display_order: 10 }), slot({ _id: new mongoose.Types.ObjectId(), time: '10:15', display_order: 20 }),
            slot({ _id: new mongoose.Types.ObjectId(), time: '10:30', display_order: 30 }), slot({ _id: new mongoose.Types.ObjectId(), time: '11:00', display_order: 40 }),
        ]) as never);
        const result = await new HomeCareAvailabilityService().listForMobile(String(serviceId), '2026-09-07', new Date('2026-09-07T07:00:00Z'));
        expect(result.map(x => x.time)).toEqual(['10:30', '11:00']);
        expect(find).toHaveBeenCalledWith({ service_id: String(serviceId), status: 'active' });
    });

    test('future dates return all active slots and missing/inactive service is hidden', async () => {
        const service = new HomeCareAvailabilityService();
        spyOn(homeCareServiceService, 'getActiveById').mockResolvedValue({ _id: serviceId } as never);
        spyOn(HomeCareAvailabilitySlot, 'find').mockReturnValue(execQuery([slot({ time: '09:00' }), slot({ _id: new mongoose.Types.ObjectId(), time: '11:00' })]) as never);
        expect(await service.listForMobile(String(serviceId), '2026-09-08', new Date('2026-09-07T07:00:00Z'))).toHaveLength(2);
        (homeCareServiceService.getActiveById as any).mockResolvedValue(null);
        await expect(service.listForMobile(String(serviceId), '2026-09-08')).rejects.toMatchObject({ status: 404 });
        await expect(service.listForMobile('bad', '2026-09-08')).rejects.toMatchObject({ status: 400 });
    });

    test('lead time excludes past/inside-window and permits the exact boundary', () => {
        const now = new Date('2026-09-07T07:00:00Z'); // 10:00 Baghdad
        expect(homeCareSlotMeetsLeadTime('2026-09-07', '09:00', now)).toBe(false);
        expect(homeCareSlotMeetsLeadTime('2026-09-07', '10:15', now)).toBe(false);
        expect(homeCareSlotMeetsLeadTime('2026-09-07', '10:30', now)).toBe(true);
        expect(homeCareSlotMeetsLeadTime('2026-09-08', '00:00', now)).toBe(true);
    });

    test('transactional claim serializes request creation against slot edits and deactivation', async () => {
        const claimed = slot({ selection_version: 2 });
        const update = spyOn(HomeCareAvailabilitySlot, 'findOneAndUpdate').mockReturnValue(execQuery(claimed) as never);
        const session = {} as mongoose.ClientSession;
        const result = await new HomeCareAvailabilityService().claimAvailableForRequest(
            String(serviceId), String(slotId), '11:00', session
        );
        expect(result).toBe(claimed as never);
        expect(update.mock.calls[0]![0]).toEqual({
            _id: String(slotId), service_id: String(serviceId), status: 'active', time: '11:00',
        });
        expect(update.mock.calls[0]![1]).toEqual({ $inc: { selection_version: 1 } });
        expect(update.mock.calls[0]![2]).toMatchObject({ new: true, session });
    });

    test('same time remains valid for a different service by index design', () => {
        const unique = HomeCareAvailabilitySlot.schema.indexes().find(([keys, options]) => keys.service_id === 1 && keys.time === 1 && options.unique);
        expect(unique?.[0]).toEqual({ service_id: 1, time: 1 });
        expect(String(otherServiceId)).not.toBe(String(serviceId));
    });
});
