import { assertLocalDate, localDateTimeToUtc, nextLocalDate, toBaghdadLocal } from './appointment-time.service';
import { DomainError } from './domain-error';

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
