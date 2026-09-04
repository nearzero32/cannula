import { describe, expect, test } from 'bun:test';
import Specialty from '../src/models/specialties.model';
import specialtyService, { mobileSpecialtiesCacheKey, MOBILE_SPECIALTIES_CACHE_TTL_SECONDS, PATIENT_SPECIALTY_SORT } from '../src/services/specialty.service';

describe('Specialty ordering and mobile cache contracts', () => {
    test('defaults to order 1000 and rejects negative or fractional ordering', () => {
        const specialty = new Specialty({ name: 'Cardiology' });
        expect(specialty.sort_order).toBe(1000);
        specialty.sort_order = -1.5;
        expect(specialty.validateSync()?.errors.sort_order).toBeDefined();
    });

    test('uses a stable patient sort before pagination', async () => {
        expect(PATIENT_SPECIALTY_SORT).toEqual({ sort_order: 1, _id: 1 });
        const model = (specialtyService as any).model, original = model.aggregate; let pipeline: any[] = [];
        model.aggregate = (value: any[]) => { pipeline = value; return { exec: async () => [{ data: [], count: [] }] }; };
        try { await specialtyService.getPaginated({ main_match: { status: 'active' }, page: 2, limit: 5, sort: PATIENT_SPECIALTY_SORT }); } finally { model.aggregate = original; }
        expect(pipeline[1].$facet.data.slice(0, 3)).toEqual([{ $sort: { sort_order: 1, _id: 1 } }, { $skip: 5 }, { $limit: 5 }]);
    });

    test('cache key varies by page, limit and normalized search with a five-minute TTL', () => {
        expect(MOBILE_SPECIALTIES_CACHE_TTL_SECONDS).toBe(300);
        expect(mobileSpecialtiesCacheKey(1, 10, 'cardiology')).toBe('cache:mobile:specialties:v1:page=1:limit=10:search=cardiology');
        expect(mobileSpecialtiesCacheKey(2, 10, 'cardiology')).not.toBe(mobileSpecialtiesCacheKey(1, 10, 'cardiology'));
        expect(mobileSpecialtiesCacheKey(1, 20, 'cardiology')).not.toBe(mobileSpecialtiesCacheKey(1, 10, 'cardiology'));
        expect(mobileSpecialtiesCacheKey(1, 10, 'dentistry')).not.toBe(mobileSpecialtiesCacheKey(1, 10, 'cardiology'));
    });

    test('rejects malformed and duplicate specialty IDs before writes', async () => {
        await expect(specialtyService.reorder(['not-an-object-id'])).rejects.toMatchObject({ code: 'INVALID_SPECIALTY_ID' });
        const id = '507f1f77bcf86cd799439011';
        await expect(specialtyService.reorder([id, id])).rejects.toMatchObject({ code: 'DUPLICATE_SPECIALTY_ID' });
    });
});
