import { describe, expect, test } from 'bun:test';
import { availableDoctorsCacheKey } from '../src/services/available-doctors.service';
import { normalizeDoctorFeaturedFilter } from '../src/controller/mobile/doctors.controller';

describe('available doctor discovery cache keys', () => {
    const base = { date: '2026-09-04', page: 1, limit: 10 };

    test('contains the Baghdad date and every response-affecting filter', () => {
        const key = availableDoctorsCacheKey({ ...base, specialty_id: 'a', clinic_id: 'b', gender: 'female', is_featured: true });
        expect(key).toBe('cache:mobile:doctors:available:v1:date=2026-09-04:page=1:limit=10:specialty=a:clinic=b:gender=female:featured=true');
        expect(availableDoctorsCacheKey({ ...base, specialty_id: 'c' })).not.toBe(key);
        expect(availableDoctorsCacheKey({ ...base, page: 2, specialty_id: 'a', clinic_id: 'b', gender: 'female', is_featured: true })).not.toBe(key);
        expect(availableDoctorsCacheKey({ ...base, date: '2026-09-05', specialty_id: 'a', clinic_id: 'b', gender: 'female', is_featured: true })).not.toBe(key);
    });

    test('normalizes omitted and false to the same filter/cache while true remains featured-only', () => {
        expect(normalizeDoctorFeaturedFilter(undefined)).toBeUndefined();
        expect(normalizeDoctorFeaturedFilter('false')).toBeUndefined();
        expect(normalizeDoctorFeaturedFilter('true')).toBe(true);
        expect(() => normalizeDoctorFeaturedFilter('featured')).toThrow();
        expect(availableDoctorsCacheKey({ ...base })).toBe(availableDoctorsCacheKey({ ...base, is_featured: false }));
        expect(availableDoctorsCacheKey({ ...base, is_featured: true })).not.toBe(availableDoctorsCacheKey({ ...base }));
    });
});
