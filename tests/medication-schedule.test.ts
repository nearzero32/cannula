import { describe, expect, test } from 'bun:test';
import { addLocalDays, dateOnlyInTimezone, normalizeSchedule, scheduleChanged, scheduledInstants, validDateOnly, validTimezone, weekdayForDateOnly, zonedLocalToUtc } from '../src/services/medication-schedule.service';
import { medicationReminderDedupeKey } from '../src/services/medication-reminder.service';

describe('Medication schedule policy', () => {
    test('normalizes daily schedules and multiple times deterministically', () => {
        const schedule = normalizeSchedule({ start_date: '2026-09-07', weekdays: [6, 0, 2, 1, 5, 4, 3], times: ['20:00', '08:00'] });
        expect(schedule).toEqual({ timezone: 'Asia/Baghdad', weekdays: [0,1,2,3,4,5,6], times: ['08:00','20:00'], start_date: '2026-09-07', end_date: null });
    });

    test('rejects duplicate times rather than silently changing patient intent', () => {
        expect(() => normalizeSchedule({ start_date: '2026-09-07', times: ['08:00', '08:00'] })).toThrow('لا يمكن تكرار وقت التذكير');
    });

    test('validates dates, times, weekdays, timezone, and end range', () => {
        expect(validDateOnly('2026-02-29')).toBe(false);
        expect(validTimezone('Asia/Baghdad')).toBe(true);
        expect(validTimezone('Not/AZone')).toBe(false);
        expect(() => normalizeSchedule({ start_date: '2026-09-08', end_date: '2026-09-07', times: ['08:00'] })).toThrow();
        expect(() => normalizeSchedule({ start_date: '2026-09-07', times: ['25:00'] })).toThrow();
        expect(() => normalizeSchedule({ start_date: '2026-09-07', weekdays: [7], times: ['08:00'] })).toThrow();
    });

    test('converts Baghdad local wall time to UTC', () => {
        expect(zonedLocalToUtc('2026-09-08', '08:00', 'Asia/Baghdad').toISOString()).toBe('2026-09-08T05:00:00.000Z');
        expect(dateOnlyInTimezone(new Date('2026-09-07T21:30:00.000Z'), 'Asia/Baghdad')).toBe('2026-09-08');
    });

    test('generates weekday-only occurrences and respects end_date', () => {
        const schedule = normalizeSchedule({ start_date: '2026-09-06', end_date: '2026-09-10', weekdays: [0,2,4], times: ['09:00'] });
        const values = scheduledInstants(schedule, new Date('2026-09-06T00:00:00Z'), new Date('2026-09-12T00:00:00Z')).map(x => x.toISOString());
        expect(values).toEqual(['2026-09-06T06:00:00.000Z','2026-09-08T06:00:00.000Z','2026-09-10T06:00:00.000Z']);
    });

    test('skips a past time today', () => {
        const schedule = normalizeSchedule({ start_date: '2026-09-07', times: ['08:00','20:00'] });
        expect(scheduledInstants(schedule, new Date('2026-09-07T10:00:00Z'), new Date('2026-09-08T00:00:00Z')).map(x => x.toISOString())).toEqual(['2026-09-07T17:00:00.000Z']);
    });

    test('date utilities keep Sunday=0 and Baghdad midnight boundaries', () => {
        expect(weekdayForDateOnly('2026-09-06')).toBe(0);
        expect(addLocalDays('2026-09-30', 1)).toBe('2026-10-01');
        expect(zonedLocalToUtc('2026-09-08', '00:00', 'Asia/Baghdad').toISOString()).toBe('2026-09-07T21:00:00.000Z');
    });

    test('only schedule material changes increment policy identity', () => {
        const a = normalizeSchedule({ start_date: '2026-09-07', times: ['08:00'] });
        expect(scheduleChanged(a, { ...a })).toBe(false);
        expect(scheduleChanged(a, { ...a, times: ['09:00'] })).toBe(true);
    });

    test('medication reminder dedupe includes all logical identity fields', () => {
        const key = medicationReminderDedupeKey('m1', 3, 'd1', 'u1');
        expect(key).toBe('medication:m1:3:dose:d1:u1');
        expect(medicationReminderDedupeKey('m1', 4, 'd1', 'u1')).not.toBe(key);
    });
});
