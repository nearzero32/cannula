import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import mongoose from 'mongoose';
import HomeCareRequestIdempotency from '../src/models/home-care-request-idempotency.model';
import {
    HOME_CARE_IDEMPOTENCY_RETENTION_HOURS,
    HomeCareRequestIdempotencyService,
    homeCareRequestFingerprint,
    validateHomeCareIdempotencyKey,
} from '../src/services/home-care-request-idempotency.service';

afterEach(() => mock.restore());

describe('Home Care request idempotency domain', () => {
    test('requires UUID v4 and normalizes case without accepting arbitrary strings', () => {
        expect(validateHomeCareIdempotencyKey('550E8400-E29B-41D4-A716-446655440000')).toBe('550e8400-e29b-41d4-a716-446655440000');
        expect(() => validateHomeCareIdempotencyKey('550e8400-e29b-11d4-a716-446655440000')).toThrow();
        expect(() => validateHomeCareIdempotencyKey(undefined)).toThrow();
    });

    test('fingerprint is deterministic across semantic nulls, address whitespace, and ObjectId case', () => {
        const base = {
            service_id: '507F191E810C19729DE86101', availability_slot_id: '507F191E810C19729DE86103', requested_date: '2099-09-07',
            address: { address_text: ' Baghdad   address ', lat: 33.3, lng: 44.3 },
        };
        expect(homeCareRequestFingerprint(base)).toBe(homeCareRequestFingerprint({
            ...base, service_id: base.service_id.toLowerCase(), availability_slot_id: base.availability_slot_id.toLowerCase(),
            child_id: null, notes: null, address: { ...base.address, address_text: 'Baghdad address' },
        }));
        expect(homeCareRequestFingerprint(base)).not.toBe(homeCareRequestFingerprint({ ...base, requested_date: '2099-09-08' }));
        expect(homeCareRequestFingerprint(base)).toMatch(/^[0-9a-f]{64}$/);
    });

    test('schema has patient-scoped uniqueness and absolute TTL retention', () => {
        const indexes = HomeCareRequestIdempotency.schema.indexes();
        expect(indexes.some(([keys, options]) => keys.patient_id === 1 && keys.idempotency_key === 1 && options.unique === true)).toBe(true);
        expect(indexes.some(([keys, options]) => keys.expires_at === 1 && options.expireAfterSeconds === 0)).toBe(true);
        expect(HOME_CARE_IDEMPOTENCY_RETENTION_HOURS).toBe(24);
        expect(HomeCareRequestIdempotency.schema.path('request_hash').options.select).toBe(false);
    });

    test('same key with a changed hash is a stable 409 conflict', () => {
        const service = new HomeCareRequestIdempotencyService();
        expect(() => service.assertCompatible({ request_hash: 'a', status: 'completed', request_id: new mongoose.Types.ObjectId() } as never, 'b'))
            .toThrow(expect.objectContaining({ status: 409, code: 'HOME_CARE_IDEMPOTENCY_CONFLICT' }));
    });

    test('a stale processing record is never treated as a successful replay', () => {
        const service = new HomeCareRequestIdempotencyService();
        expect(() => service.assertCompatible({ request_hash: 'a', status: 'processing', request_id: null } as never, 'a'))
            .toThrow(expect.objectContaining({ status: 409, code: 'HOME_CARE_IDEMPOTENCY_PROCESSING' }));
    });
});
