import { describe, expect, test } from 'bun:test';
import { generateAppointmentSlots } from '../src/services/appointment-slot.service';
import { localDateTimeToUtc } from '../src/services/appointment-time.service';

const base = {
    date: '2026-09-10', periods: [{ start_time: '09:00', end_time: '12:00' }], duration: 30, interval: 30,
    before: 0, after: 0, leadMinutes: 0, now: new Date('2026-09-09T00:00:00.000Z'), existing: [],
};
const existing = (start: string, end: string) => ({ blocked_starts_at: localDateTimeToUtc(base.date, start), blocked_ends_at: localDateTimeToUtc(base.date, end) });

describe('Appointment slot engine', () => {
    test('generates weekly slots with backend-owned duration', () => {
        const slots = generateAppointmentSlots(base);
        expect(slots.map(slot => slot.localStartsAt)).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00', '11:30']);
        expect(slots[0].endsAt).toBe('2026-09-10T06:30:00.000Z');
    });

    test('supports interval different from duration', () => {
        const slots = generateAppointmentSlots({ ...base, interval: 15 });
        expect(slots.map(slot => slot.localStartsAt)).toEqual(['09:00', '09:15', '09:30', '09:45', '10:00', '10:15', '10:30', '10:45', '11:00', '11:15', '11:30']);
    });

    test('supports multiple periods without filling the break', () => {
        const slots = generateAppointmentSlots({ ...base, periods: [{ start_time: '09:00', end_time: '10:00' }, { start_time: '16:00', end_time: '17:00' }] });
        expect(slots.map(slot => slot.localStartsAt)).toEqual(['09:00', '09:30', '16:00', '16:30']);
    });

    test('closed day and closed exception result produce no slots', () => {
        expect(generateAppointmentSlots({ ...base, periods: [] })).toEqual([]);
    });

    test('custom hours override can be passed as the only effective periods', () => {
        const slots = generateAppointmentSlots({ ...base, periods: [{ start_time: '12:00', end_time: '14:00' }] });
        expect(slots.map(slot => slot.localStartsAt)).toEqual(['12:00', '12:30', '13:00', '13:30']);
    });

    test('buffers must fit inside the working period and are exposed as blocked bounds', () => {
        const slots = generateAppointmentSlots({ ...base, before: 10, after: 10 });
        expect(slots.map(slot => slot.localStartsAt)).toEqual(['09:30', '10:00', '10:30', '11:00']);
        expect(slots[0].blockedStartsAt).toBe('2026-09-10T06:20:00.000Z');
        expect(slots[0].blockedEndsAt).toBe('2026-09-10T07:10:00.000Z');
    });

    test('exact and partial overlaps remove candidate slots', () => {
        expect(generateAppointmentSlots({ ...base, existing: [existing('09:00', '09:30')] }).map(slot => slot.localStartsAt)).not.toContain('09:00');
        expect(generateAppointmentSlots({ ...base, existing: [existing('09:15', '09:45')] }).map(slot => slot.localStartsAt)).toEqual(['10:00', '10:30', '11:00', '11:30']);
    });

    test('touching an occupied boundary is allowed', () => {
        const slots = generateAppointmentSlots({ ...base, existing: [existing('09:00', '09:30')] });
        expect(slots.map(slot => slot.localStartsAt)).toContain('09:30');
    });

    test('existing buffered intervals block otherwise non-overlapping appointments', () => {
        const slots = generateAppointmentSlots({ ...base, interval: 15, existing: [existing('09:20', '10:10')] });
        expect(slots.map(slot => slot.localStartsAt)).toEqual(['10:15', '10:30', '10:45', '11:00', '11:15', '11:30']);
    });

    test('past slots and exact lead-time boundary are enforced by absolute instant', () => {
        const now = localDateTimeToUtc(base.date, '09:00');
        expect(generateAppointmentSlots({ ...base, now }).map(slot => slot.localStartsAt)[0]).toBe('09:00');
        expect(generateAppointmentSlots({ ...base, now, leadMinutes: 60 }).map(slot => slot.localStartsAt)[0]).toBe('10:00');
        expect(generateAppointmentSlots({ ...base, now: localDateTimeToUtc(base.date, '14:30') })).toEqual([]);
    });
});
