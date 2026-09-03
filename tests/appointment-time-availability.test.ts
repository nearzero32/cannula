import { describe, expect, test } from 'bun:test';
import { APPOINTMENT_TIMEZONE } from '../src/interfaces/appointment.interface';
import { assertLocalDate, assertLocalTime, localDateRangeUtc, localDateTimeToUtc, localDayOfWeek, nextLocalDate, toBaghdadLocal } from '../src/services/appointment-time.service';
import { validateAvailabilityPeriods } from '../src/services/doctor-availability.service';
import { DomainError } from '../src/services/domain-error';

describe('Appointment Baghdad time policy', () => {
    test('converts Baghdad wall time to an absolute UTC instant deterministically', () => {
        const instant = localDateTimeToUtc('2026-09-10', '09:30');
        expect(instant.toISOString()).toBe('2026-09-10T06:30:00.000Z');
        expect(toBaghdadLocal(instant)).toEqual({ date: '2026-09-10', time: '09:30', timezone: APPOINTMENT_TIMEZONE });
    });

    test('builds exact Baghdad calendar-day UTC boundaries', () => {
        expect(localDateRangeUtc('2026-09-10')).toEqual({ start: new Date('2026-09-09T21:00:00.000Z'), end: new Date('2026-09-10T21:00:00.000Z') });
        expect(nextLocalDate('2026-12-31')).toBe('2027-01-01');
        expect(localDayOfWeek('2026-09-13')).toBe(0);
    });

    test('rejects impossible dates and invalid HH:mm values with stable codes', () => {
        for (const date of ['2026-02-30', '10-09-2026', '2026-9-10']) {
            try { assertLocalDate(date); throw new Error('expected rejection'); } catch (error) { expect((error as DomainError).code).toBe('APPOINTMENT_DATE_INVALID'); }
        }
        for (const time of ['9:00', '24:00', '12:60']) {
            try { assertLocalTime(time); throw new Error('expected rejection'); } catch (error) { expect((error as DomainError).code).toBe('APPOINTMENT_TIME_INVALID'); }
        }
    });
});

describe('Doctor weekly availability validation', () => {
    test('sorts valid multiple periods and preserves breaks', () => {
        expect(validateAvailabilityPeriods([{ start_time: '16:00', end_time: '20:00' }, { start_time: '09:00', end_time: '13:00' }])).toEqual([
            { start_time: '09:00', end_time: '13:00' }, { start_time: '16:00', end_time: '20:00' },
        ]);
    });

    test('rejects overlapping periods', () => {
        expect(() => validateAvailabilityPeriods([{ start_time: '09:00', end_time: '13:00' }, { start_time: '12:59', end_time: '14:00' }])).toThrow('متداخلة');
        try { validateAvailabilityPeriods([{ start_time: '09:00', end_time: '13:00' }, { start_time: '12:59', end_time: '14:00' }]); } catch (error) { expect((error as DomainError).code).toBe('AVAILABILITY_OVERLAP'); }
    });

    test('allows touching periods but rejects reversed and malformed periods', () => {
        expect(validateAvailabilityPeriods([{ start_time: '09:00', end_time: '13:00' }, { start_time: '13:00', end_time: '14:00' }])).toHaveLength(2);
        expect(() => validateAvailabilityPeriods([{ start_time: '13:00', end_time: '12:00' }])).toThrow();
        expect(() => validateAvailabilityPeriods([{ start_time: '9:00', end_time: '12:00' }])).toThrow();
    });
});
