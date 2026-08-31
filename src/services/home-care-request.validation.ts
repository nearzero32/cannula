import { DomainError } from './domain-error';

export interface HomeCareRequestAddressInput {
    address_text: string;
    lat: number;
    lng: number;
}

export function validateRequestedDate(value: string, now = new Date()): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new DomainError('التاريخ المطلوب غير صالح', 400);
    }
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
        throw new DomainError('التاريخ المطلوب غير صالح', 400);
    }
    const today = new Date(now);
    today.setUTCHours(0, 0, 0, 0);
    if (date.getTime() < today.getTime()) {
        throw new DomainError('لا يمكن اختيار تاريخ سابق', 422);
    }
    return date;
}

export function validatePreferredTime(value: string): string {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
        throw new DomainError('الوقت المفضل غير صالح', 400);
    }
    return value;
}

export function validateHomeCareRequestAddress(
    address: HomeCareRequestAddressInput
): HomeCareRequestAddressInput {
    const addressText = address.address_text.normalize('NFKC').trim().replace(/\s+/g, ' ');
    if (addressText.length < 5 || addressText.length > 500) {
        throw new DomainError('عنوان المنزل غير صالح', 400);
    }
    if (!Number.isFinite(address.lat) || address.lat < -90 || address.lat > 90) {
        throw new DomainError('خط العرض غير صالح', 400);
    }
    if (!Number.isFinite(address.lng) || address.lng < -180 || address.lng > 180) {
        throw new DomainError('خط الطول غير صالح', 400);
    }
    return { address_text: addressText, lat: address.lat, lng: address.lng };
}

export function normalizeOptionalRequestText(
    value: string | null | undefined,
    maximumLength: number,
    errorMessage: string
): string | null {
    if (value === null || value === undefined) return null;
    const normalized = value.normalize('NFKC').trim();
    if (normalized.length > maximumLength) throw new DomainError(errorMessage, 400);
    return normalized || null;
}
