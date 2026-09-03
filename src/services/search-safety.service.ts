import { DomainError } from './domain-error';

/** Produces a bounded literal Mongo regex pattern; user input never controls regex syntax. */
export function safeSearchPattern(value: string): string {
    const normalized = value.trim();
    if (normalized.length > 128) throw new DomainError('نص البحث طويل جدًا', 422, 'SEARCH_TOO_LONG');
    return normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
