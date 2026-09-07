import { DomainError } from './domain-error';
import type { PatientMedicationSchedule } from '../interfaces/patient-medication.interface';
import { PATIENT_MEDICATION_DEFAULT_TIMEZONE, PATIENT_MEDICATION_MAX_TIMES_PER_DAY } from '../interfaces/patient-medication.interface';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validDateOnly(value: string): boolean {
    if (!DATE_ONLY.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validTimezone(value: string): boolean {
    try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(); return true; } catch { return false; }
}

export function normalizeSchedule(input: Partial<PatientMedicationSchedule>, current?: PatientMedicationSchedule): PatientMedicationSchedule {
    const timezone = input.timezone ?? current?.timezone ?? PATIENT_MEDICATION_DEFAULT_TIMEZONE;
    const weekdays = [...new Set(input.weekdays ?? current?.weekdays ?? [0, 1, 2, 3, 4, 5, 6])].sort((a, b) => a - b);
    const rawTimes = input.times ?? current?.times ?? [];
    if (new Set(rawTimes).size !== rawTimes.length) throw new DomainError('لا يمكن تكرار وقت التذكير', 400, 'DUPLICATE_REMINDER_TIME');
    const times = [...rawTimes].sort();
    const start_date = input.start_date ?? current?.start_date ?? '';
    const end_date = input.end_date === undefined ? (current?.end_date ?? null) : input.end_date;
    if (!validTimezone(timezone)) throw new DomainError('المنطقة الزمنية غير صالحة', 400, 'INVALID_TIMEZONE');
    if (!weekdays.length || weekdays.length > 7 || weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6)) throw new DomainError('أيام التذكير غير صالحة', 400, 'INVALID_WEEKDAYS');
    if (!times.length || times.length > PATIENT_MEDICATION_MAX_TIMES_PER_DAY || times.some(time => !TIME.test(time))) throw new DomainError('أوقات التذكير غير صالحة', 400, 'INVALID_REMINDER_TIMES');
    if (!validDateOnly(start_date) || (end_date !== null && !validDateOnly(end_date))) throw new DomainError('نطاق تاريخ التذكير غير صالح', 400, 'INVALID_SCHEDULE_DATE');
    if (end_date && end_date < start_date) throw new DomainError('يجب ألا يسبق تاريخ النهاية تاريخ البداية', 400, 'INVALID_SCHEDULE_RANGE');
    return { timezone, weekdays, times, start_date, end_date };
}

export function scheduleChanged(a: PatientMedicationSchedule, b: PatientMedicationSchedule): boolean {
    return a.timezone !== b.timezone || a.start_date !== b.start_date || a.end_date !== b.end_date ||
        a.weekdays.join(',') !== b.weekdays.join(',') || a.times.join(',') !== b.times.join(',');
}

function partsAt(date: Date, timezone: string) {
    const values: Record<string, number> = {};
    for (const part of new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date)) {
        if (part.type !== 'literal') values[part.type] = Number(part.value);
    }
    return values as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

export function zonedLocalToUtc(dateOnly: string, time: string, timezone: string): Date {
    const [year, month, day] = dateOnly.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);
    const wanted = Date.UTC(year!, month! - 1, day!, hour!, minute!, 0);
    let guess = wanted;
    for (let i = 0; i < 3; i++) {
        const p = partsAt(new Date(guess), timezone);
        const represented = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
        guess += wanted - represented;
    }
    return new Date(guess);
}

export function dateOnlyInTimezone(date: Date, timezone: string): string {
    const p = partsAt(date, timezone);
    return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function addLocalDays(dateOnly: string, days: number): string {
    const date = new Date(`${dateOnly}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

export function weekdayForDateOnly(dateOnly: string): number {
    return new Date(`${dateOnly}T00:00:00.000Z`).getUTCDay();
}

export function scheduledInstants(schedule: PatientMedicationSchedule, from: Date, until: Date): Date[] {
    const results: Date[] = [];
    let localDate = dateOnlyInTimezone(from, schedule.timezone);
    const lastLocalDate = dateOnlyInTimezone(until, schedule.timezone);
    while (localDate <= lastLocalDate) {
        if (localDate >= schedule.start_date && (!schedule.end_date || localDate <= schedule.end_date) && schedule.weekdays.includes(weekdayForDateOnly(localDate))) {
            for (const time of schedule.times) {
                const instant = zonedLocalToUtc(localDate, time, schedule.timezone);
                if (instant > from && instant <= until) results.push(instant);
            }
        }
        localDate = addLocalDays(localDate, 1);
    }
    return results.sort((a, b) => a.getTime() - b.getTime());
}
