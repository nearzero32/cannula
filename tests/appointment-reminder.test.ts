import { describe, expect, test } from 'bun:test';
import {
    APPOINTMENT_REMINDER_OFFSETS_MINUTES,
    appointmentReminderContent,
    appointmentReminderDedupeKey,
    getFutureReminderTimes,
} from '../src/services/appointment-reminder.service';

describe('Appointment reminder policy', () => {
    const now = new Date('2026-09-05T09:00:00.000Z');

    test('30 hours schedules exact 24h and 2h reminders', () => {
        const result = getFutureReminderTimes(new Date(now.getTime() + 30 * 60 * 60_000), now);
        expect(APPOINTMENT_REMINDER_OFFSETS_MINUTES).toEqual([1440, 120]);
        expect(result.map(item => item.offsetMinutes)).toEqual([1440, 120]);
        expect(result.map(item => item.reminderAt.toISOString())).toEqual([
            '2026-09-05T15:00:00.000Z',
            '2026-09-06T13:00:00.000Z',
        ]);
    });

    test('10 hours schedules only the 2h reminder', () => {
        expect(getFutureReminderTimes(new Date(now.getTime() + 10 * 60 * 60_000), now)
            .map(item => item.offsetMinutes)).toEqual([120]);
    });

    test('90 minutes schedules no reminder', () => {
        expect(getFutureReminderTimes(new Date(now.getTime() + 90 * 60_000), now)).toEqual([]);
    });

    test('an exact 2h boundary is excluded', () => {
        expect(getFutureReminderTimes(new Date(now.getTime() + 120 * 60_000), now)).toEqual([]);
    });

    test('dedupe key changes for every logical identity component', () => {
        const key = appointmentReminderDedupeKey('appointment-a', 3, 1440, 'user-a');
        expect(key).toBe('appointment:appointment-a:3:reminder:1440:user-a');
        expect(appointmentReminderDedupeKey('appointment-a', 3, 1440, 'user-a')).toBe(key);
        expect(appointmentReminderDedupeKey('appointment-a', 3, 120, 'user-a')).not.toBe(key);
        expect(appointmentReminderDedupeKey('appointment-a', 4, 1440, 'user-a')).not.toBe(key);
        expect(appointmentReminderDedupeKey('appointment-b', 3, 1440, 'user-a')).not.toBe(key);
    });

    test('content uses Baghdad date/time and contains no private fields', () => {
        const content = appointmentReminderContent('أحمد', new Date('2026-09-10T06:30:00.000Z'));
        expect(content).toEqual({
            title: 'تذكير بالموعد',
            body: 'موعدك مع د. أحمد بتاريخ 2026-09-10 الساعة 09:30',
        });
        expect(JSON.stringify(content)).not.toMatch(/reason|notes|diagnosis|patient/);
    });
});
