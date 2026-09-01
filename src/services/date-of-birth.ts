import { DomainError } from './domain-error';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const MIN_DATE_OF_BIRTH = '1900-01-01';

export function parseDateOfBirth(value: string): Date {
    if (!ISO_DATE_PATTERN.test(value)) {
        throw new DomainError('تاريخ الميلاد يجب أن يكون بصيغة YYYY-MM-DD', 400);
    }
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
        throw new DomainError('تاريخ الميلاد غير صالح', 400);
    }
    if (value < MIN_DATE_OF_BIRTH) {
        throw new DomainError(`تاريخ الميلاد يجب ألا يسبق ${MIN_DATE_OF_BIRTH}`, 400);
    }
    if (value > new Date().toISOString().slice(0, 10)) {
        throw new DomainError('تاريخ الميلاد لا يمكن أن يكون في المستقبل', 400);
    }
    return date;
}

export function calculateAge(dateOfBirth: Date, now = new Date()): number {
    let age = now.getUTCFullYear() - dateOfBirth.getUTCFullYear();
    const beforeBirthday = now.getUTCMonth() < dateOfBirth.getUTCMonth() ||
        (now.getUTCMonth() === dateOfBirth.getUTCMonth() && now.getUTCDate() < dateOfBirth.getUTCDate());
    if (beforeBirthday) age -= 1;
    return Math.max(0, age);
}

export function formatDateOfBirth(dateOfBirth: Date): string;
export function formatDateOfBirth(dateOfBirth: null | undefined): null;
export function formatDateOfBirth(dateOfBirth: Date | null | undefined): string | null;
export function formatDateOfBirth(dateOfBirth: Date | null | undefined): string | null {
    return dateOfBirth ? dateOfBirth.toISOString().slice(0, 10) : null;
}
