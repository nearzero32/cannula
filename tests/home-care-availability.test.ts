import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import mongoose from 'mongoose';
import HomeCareService from '../src/models/home-care-service.model';
import HomeCareAvailabilitySlot from '../src/models/home-care-availability-slot.model';
import homeCareServiceService from '../src/services/home-care-service.service';
import ActivityLogService from '../src/services/activity-log.service';
import {
    HomeCareAvailabilityService,
    validateHomeCareWeeklySchedule,
    type HomeCareWeeklyScheduleDay,
} from '../src/services/home-care-availability.service';
import { homeCareSlotMeetsLeadTime, homeCareWeekdayForDate } from '../src/services/home-care-date.service';
import { HOME_CARE_WEEKDAYS, HomeCareWeekdayEnum } from '../src/interfaces/home-care.interface';

const serviceId = new mongoose.Types.ObjectId('507f191e810c19729de86101');
const slotId = new mongoose.Types.ObjectId('507f191e810c19729de86103');
const actor = { user_id: '507f191e810c19729de86104', user_type: 'admin', source: 'dashboard' };
const slot = (overrides: any = {}) => ({ _id: slotId, service_id: serviceId, day_of_week: 'SATURDAY', time: '11:00', status: 'active', display_order: 10, ...overrides });
const execQuery = (value: any) => ({ exec: async () => value, select() { return this; }, lean() { return this; }, session() { return this; }, sort() { return this; } });
const week = (overrides: Partial<Record<string, string[]>> = {}): HomeCareWeeklyScheduleDay[] =>
    HOME_CARE_WEEKDAYS.map(day => ({ day_of_week: day, times: overrides[day] ?? [] }));

beforeEach(() => { spyOn(ActivityLogService, 'logActivity').mockResolvedValue({} as never); });
afterEach(() => mock.restore());

describe('Home Care weekly availability domain', () => {
    test('weekday enum is explicit and ordered Saturday through Friday', () => {
        expect(HOME_CARE_WEEKDAYS).toEqual(['SATURDAY', 'SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']);
        expect(Object.values(HomeCareWeekdayEnum)).toEqual([...HOME_CARE_WEEKDAYS]);
    });

    test('Baghdad date-only weekday resolution is stable', () => {
        expect(homeCareWeekdayForDate('2026-09-12')).toBe('SATURDAY');
        expect(homeCareWeekdayForDate('2026-09-13')).toBe('SUNDAY');
        expect(homeCareWeekdayForDate('2026-09-18')).toBe('FRIDAY');
        expect(() => homeCareWeekdayForDate('2026-02-30')).toThrow();
    });

    test('weekday resolution is independent of the process timezone', () => {
        const original = process.env.TZ;
        try {
            process.env.TZ = 'Pacific/Auckland';
            expect(homeCareWeekdayForDate('2026-09-12')).toBe('SATURDAY');
            process.env.TZ = 'America/Los_Angeles';
            expect(homeCareWeekdayForDate('2026-09-12')).toBe('SATURDAY');
        } finally {
            if (original === undefined) delete process.env.TZ;
            else process.env.TZ = original;
        }
    });

    test('model uniqueness is service + weekday + time and mobile index includes weekday', () => {
        const indexes = HomeCareAvailabilitySlot.schema.indexes();
        expect(indexes.some(([keys, options]) => keys.service_id === 1 && keys.day_of_week === 1 && keys.time === 1 && options.unique === true)).toBe(true);
        expect(indexes.some(([keys]) => keys.service_id === 1 && keys.day_of_week === 1 && keys.status === 1 && keys.display_order === 1)).toBe(true);
        expect(HomeCareAvailabilitySlot.schema.path('service_id').options.immutable).toBe(true);
        expect(HomeCareAvailabilitySlot.schema.path('day_of_week').options.immutable).toBe(true);
        expect(HomeCareAvailabilitySlot.schema.path('time').options.immutable).toBe(true);
    });

    test('validates a complete week, allowing closed days and the same time on different days', () => {
        const result = validateHomeCareWeeklySchedule(week({ SATURDAY: ['09:00'], SUNDAY: ['09:00'] }));
        expect(result[0]).toEqual({ day_of_week: 'SATURDAY', times: ['09:00'] });
        expect(result[6]).toEqual({ day_of_week: 'FRIDAY', times: [] });
    });

    test('rejects incomplete weeks, duplicate weekdays, duplicate daily times, and invalid values', () => {
        expect(() => validateHomeCareWeeklySchedule(week().slice(0, 6))).toThrow();
        const duplicateDay = week(); duplicateDay[6] = { day_of_week: 'SATURDAY', times: [] };
        expect(() => validateHomeCareWeeklySchedule(duplicateDay)).toThrow();
        expect(() => validateHomeCareWeeklySchedule(week({ SATURDAY: ['09:00', '09:00'] }))).toThrow();
        expect(() => validateHomeCareWeeklySchedule(week({ SATURDAY: ['9:00'] }))).toThrow();
        expect(() => validateHomeCareWeeklySchedule(week({ SATURDAY: Array.from({ length: 25 }, (_, index) => `${String(index % 24).padStart(2, '0')}:00`) }))).toThrow();
        const invalid = week(); invalid[0] = { day_of_week: 'FUNDAY' as never, times: [] };
        expect(() => validateHomeCareWeeklySchedule(invalid)).toThrow();
    });

    test('dashboard GET always returns all seven weekdays and empty times for closed days', async () => {
        spyOn(HomeCareService, 'findById').mockReturnValue(execQuery({ _id: serviceId }) as never);
        spyOn(HomeCareAvailabilitySlot, 'find').mockReturnValue(execQuery([
            slot({ day_of_week: 'SATURDAY', time: '09:00' }),
            slot({ _id: new mongoose.Types.ObjectId(), day_of_week: 'SUNDAY', time: '10:00' }),
        ]) as never);
        const result = await new HomeCareAvailabilityService().listForDashboard(String(serviceId));
        expect(result.timezone).toBe('Asia/Baghdad');
        expect(result.schedule).toHaveLength(7);
        expect(result.schedule[0]?.times).toEqual(['09:00']);
        expect(result.schedule[6]).toEqual({ day_of_week: 'FRIDAY', times: [] });
    });

    test('weekly PUT deactivates weekday-aware rows and upserts every desired triple in one transaction', async () => {
        spyOn(HomeCareService, 'findById').mockReturnValue(execQuery({ _id: serviceId }) as never);
        const session: any = { withTransaction: async (work: any) => work(), endSession: async () => {} };
        spyOn(mongoose, 'startSession').mockResolvedValue(session);
        spyOn(HomeCareAvailabilitySlot, 'find').mockReturnValue(execQuery([]) as never);
        const deactivate = spyOn(HomeCareAvailabilitySlot, 'updateMany').mockResolvedValue({ modifiedCount: 1 } as never);
        const bulk = spyOn(HomeCareAvailabilitySlot, 'bulkWrite').mockResolvedValue({} as never);
        const service = new HomeCareAvailabilityService();
        spyOn(service, 'listForDashboard').mockResolvedValue({ service_id: String(serviceId), timezone: 'Asia/Baghdad', schedule: week({ SATURDAY: ['09:00'], SUNDAY: ['09:00'] }) });
        await service.replaceWeekly(String(serviceId), { schedule: week({ SATURDAY: ['09:00'], SUNDAY: ['09:00'] }) }, actor);
        expect(deactivate).toHaveBeenCalledTimes(1);
        expect(bulk).toHaveBeenCalledTimes(1);
        const operations = bulk.mock.calls[0]![0] as any[];
        expect(operations.map(operation => operation.updateOne.filter.day_of_week)).toEqual(['SATURDAY', 'SUNDAY']);
        expect(operations.every(operation => operation.updateOne.filter.time === '09:00')).toBe(true);
        expect(bulk.mock.calls[0]![1]).toMatchObject({ ordered: true, session });
    });

    test('mobile date selects only its weekday before applying the same-day lead rule', async () => {
        spyOn(homeCareServiceService, 'getActiveById').mockResolvedValue({ _id: serviceId } as never);
        const find = spyOn(HomeCareAvailabilitySlot, 'find').mockReturnValue(execQuery([
            slot({ time: '10:15' }), slot({ _id: new mongoose.Types.ObjectId(), time: '10:30', display_order: 20 }),
        ]) as never);
        const result = await new HomeCareAvailabilityService().listForMobile(String(serviceId), '2026-09-12', new Date('2026-09-12T07:00:00Z'));
        expect(result.map(item => item.time)).toEqual(['10:30']);
        expect(find).toHaveBeenCalledWith({ service_id: String(serviceId), day_of_week: 'SATURDAY', status: 'active' });
    });

    test('lead time excludes inside-window, permits exact boundary, and never filters a future day', () => {
        const now = new Date('2026-09-12T07:00:00Z');
        expect(homeCareSlotMeetsLeadTime('2026-09-12', '09:00', now)).toBe(false);
        expect(homeCareSlotMeetsLeadTime('2026-09-12', '10:15', now)).toBe(false);
        expect(homeCareSlotMeetsLeadTime('2026-09-12', '10:29', now)).toBe(false);
        expect(homeCareSlotMeetsLeadTime('2026-09-12', '10:30', now)).toBe(true);
        expect(homeCareSlotMeetsLeadTime('2026-09-12', '11:00', now)).toBe(true);
        expect(homeCareSlotMeetsLeadTime('2026-09-13', '00:00', now)).toBe(true);
    });

    test('request precheck and CAS claim both constrain the resolved weekday', async () => {
        const find = spyOn(HomeCareAvailabilitySlot, 'findOne').mockReturnValue(execQuery(slot()) as never);
        const service = new HomeCareAvailabilityService();
        await service.requireAvailableForRequest(String(serviceId), String(slotId), '2026-09-12');
        expect(find.mock.calls[0]![0]).toMatchObject({ day_of_week: 'SATURDAY' });
        const update = spyOn(HomeCareAvailabilitySlot, 'findOneAndUpdate').mockReturnValue(execQuery(slot()) as never);
        const session = {} as mongoose.ClientSession;
        await service.claimAvailableForRequest(String(serviceId), String(slotId), '2026-09-12', '11:00', session);
        expect(update.mock.calls[0]![0]).toMatchObject({ day_of_week: 'SATURDAY', time: '11:00', status: 'active' });
        expect(update.mock.calls[0]![1]).toEqual({ $inc: { selection_version: 1 } });
    });
});
