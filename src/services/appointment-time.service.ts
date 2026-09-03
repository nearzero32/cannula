import { APPOINTMENT_TIMEZONE } from '../interfaces/appointment.interface';
import { DomainError } from './domain-error';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: APPOINTMENT_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const parts = (instant: Date) => Object.fromEntries(formatter.formatToParts(instant).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));

export function assertLocalDate(value: string): string {
    if (!DATE.test(value)) throw new DomainError('التاريخ غير صالح', 400, 'APPOINTMENT_DATE_INVALID');
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new DomainError('التاريخ غير صالح', 400, 'APPOINTMENT_DATE_INVALID');
    return value;
}
export function assertLocalTime(value: string): string {
    if (!TIME.test(value)) throw new DomainError('الوقت غير صالح', 400, 'APPOINTMENT_TIME_INVALID');
    return value;
}
export const timeToMinutes = (value: string) => { assertLocalTime(value); const [hour, minute] = value.split(':').map(Number); return hour * 60 + minute; };
export const minutesToTime = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;

/** Converts a wall-clock time in Asia/Baghdad to an absolute UTC instant using Intl timezone data. */
export function localDateTimeToUtc(localDate: string, localTime: string): Date {
    assertLocalDate(localDate); assertLocalTime(localTime);
    const [year, month, day] = localDate.split('-').map(Number), [hour, minute] = localTime.split(':').map(Number);
    const desired = Date.UTC(year, month - 1, day, hour, minute);
    let candidate = new Date(desired);
    for (let attempt = 0; attempt < 2; attempt++) {
        const shown = parts(candidate);
        const represented = Date.UTC(Number(shown.year), Number(shown.month) - 1, Number(shown.day), Number(shown.hour), Number(shown.minute));
        candidate = new Date(candidate.getTime() + desired - represented);
    }
    const check = toBaghdadLocal(candidate);
    if (check.date !== localDate || check.time !== localTime) throw new DomainError('الوقت المحلي غير صالح', 400, 'APPOINTMENT_TIME_INVALID');
    return candidate;
}
export function toBaghdadLocal(instant: Date) {
    const value = parts(instant);
    return { date: `${value.year}-${value.month}-${value.day}`, time: `${value.hour}:${value.minute}`, timezone: APPOINTMENT_TIMEZONE };
}
export function localDayOfWeek(localDate: string) {
    assertLocalDate(localDate); return new Date(`${localDate}T00:00:00.000Z`).getUTCDay();
}
export function nextLocalDate(localDate: string) {
    const date = new Date(`${assertLocalDate(localDate)}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10);
}
export function localDateRangeUtc(localDate: string) {
    return { start: localDateTimeToUtc(localDate, '00:00'), end: localDateTimeToUtc(nextLocalDate(localDate), '00:00') };
}
export const addMinutes = (instant: Date, minutes: number) => new Date(instant.getTime() + minutes * 60_000);
export const minutesUntil = (instant: Date, now = new Date()) => (instant.getTime() - now.getTime()) / 60_000;
