import { assertLocalDate, localDateTimeToUtc, nextLocalDate } from './appointment-time.service';
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
