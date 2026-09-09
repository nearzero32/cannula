import { assertLocalDate, localDateTimeToUtc, nextLocalDate, toBaghdadLocal } from './appointment-time.service';
import { DomainError } from './domain-error';
import { HOME_CARE_WEEKDAYS, type HomeCareWeekday } from '../interfaces/home-care.interface';

export const HOME_CARE_TIMEZONE = 'Asia/Baghdad' as const;

/** Resolves a validated date-only value independently of the deployment server timezone. */
export function homeCareWeekdayForDate(localDate: string): HomeCareWeekday {
    let date: string;
    try { date = assertLocalDate(localDate); } catch { throw new DomainError('التاريخ المطلوب غير صالح', 400); }
    const sundayFirstIndex = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    return HOME_CARE_WEEKDAYS[(sundayFirstIndex + 1) % 7]!;
}

/** Half-open Asia/Baghdad date range for Home Care's stored date-only field. */
export function homeCareBaghdadDateRange(from?: string, to?: string): Record<string, Date> | undefined {
    if (!from && !to) return undefined;
    try {
        const range: Record<string, Date> = {};
        if (from) range.$gte = localDateTimeToUtc(assertLocalDate(from), '00:00');
        if (to) range.$lt = localDateTimeToUtc(nextLocalDate(assertLocalDate(to)), '00:00');
        return range;
    } catch { throw new DomainError('التاريخ غير صالح', 400); }
}

export const HOME_CARE_REQUEST_MIN_LEAD_MINUTES = 30;

export function homeCareSlotMeetsLeadTime(localDate: string, time: string, now = new Date()): boolean {
    if (toBaghdadLocal(now).date !== localDate) return true;
    return localDateTimeToUtc(localDate, time).getTime() >= now.getTime() + HOME_CARE_REQUEST_MIN_LEAD_MINUTES * 60_000;
}

export function assertHomeCareSlotLeadTime(localDate: string, time: string, now = new Date()): void {
    if (!homeCareSlotMeetsLeadTime(localDate, time, now)) {
        throw new DomainError('وقت الطلب يجب أن يكون بعد 30 دقيقة على الأقل', 422, 'HOME_CARE_REQUEST_LEAD_TIME');
    }
}
