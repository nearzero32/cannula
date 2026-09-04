import { describe, expect, test } from 'bun:test';
import { availableDoctorsCacheKey } from '../src/services/available-doctors.service';

describe('available doctor discovery cache keys', () => {
    const base = { date: '2026-09-04', page: 1, limit: 10 };

    test('contains the Baghdad date and every response-affecting filter', () => {
        const key = availableDoctorsCacheKey({ ...base, specialty_id: 'a', clinic_id: 'b', gender: 'female', is_featured: true });
        expect(key).toBe('cache:mobile:doctors:available:v1:date=2026-09-04:page=1:limit=10:specialty=a:clinic=b:gender=female:featured=true');
        expect(availableDoctorsCacheKey({ ...base, specialty_id: 'c' })).not.toBe(key);
        expect(availableDoctorsCacheKey({ ...base, page: 2, specialty_id: 'a', clinic_id: 'b', gender: 'female', is_featured: true })).not.toBe(key);
        expect(availableDoctorsCacheKey({ ...base, date: '2026-09-05', specialty_id: 'a', clinic_id: 'b', gender: 'female', is_featured: true })).not.toBe(key);
    });
});
