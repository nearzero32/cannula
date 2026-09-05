import { describe, expect, test } from 'bun:test';
import mongoose from 'mongoose';
import {
    credentialDocument, deterministicObjectId, knownSeedIds, parseSeedArgs, relativeDates,
    RESET_ENTITY_KEYS, resolveConnectionPlan, validAvailabilityPeriods,
} from '../scripts/mobile-seed/core';
import {
    AVAILABILITY_PATTERNS, DOCTOR_NAMES, DOCTOR_PUBLIC_VISIBILITY,
    NOTIFICATION_SEED_POLICY,
} from '../scripts/mobile-seed/fixtures';

describe('mobile demo seed pure contracts', () => {
    test('stable keys produce stable ObjectIds and distinct keys do not collide', () => {
        const first = deterministicObjectId('doctor', 'doctor-1');
        expect(first).toEqual(deterministicObjectId('doctor', 'doctor-1'));
        expect(first).not.toEqual(deterministicObjectId('doctor', 'doctor-2'));
        expect(mongoose.Types.ObjectId.isValid(first)).toBe(true);
    });

    test('relative Baghdad dates cross month boundaries and preserve requested local time', () => {
        const dates = relativeDates(new Date('2026-01-31T20:30:00.000Z'));
        expect(dates.localDate(0)).toBe('2026-01-31');
        expect(dates.localDate(1)).toBe('2026-02-01');
        expect(dates.at(1, '09:15').toISOString()).toBe('2026-02-01T06:15:00.000Z');
    });

    test('remote target requires both a seed URI and explicit remote permission', () => {
        const remote = parseSeedArgs(['--target=remote']);
        expect(() => resolveConnectionPlan(remote, { SEED_MONGODB_URI: 'mongodb://staging.example/cannula_stage' })).toThrow('--allow-remote');
        expect(resolveConnectionPlan({ ...remote, allowRemote: true }, { SEED_MONGODB_URI: 'mongodb://staging.example/cannula_stage' }).database).toBe('cannula_stage');
    });

    test('production-like targets require the dangerous flag and exact confirmation', () => {
        const local = parseSeedArgs([]);
        const env = { MONGODB_URI: 'mongodb://localhost:27017/cannula_production' };
        expect(() => resolveConnectionPlan(local, env)).toThrow('Production-like target refused');
        expect(() => resolveConnectionPlan({ ...local, allowProductionSeed: true, confirm: 'WRONG' }, env)).toThrow('Production-like target refused');
        expect(resolveConnectionPlan({ ...local, allowProductionSeed: true, confirm: 'CANNULA_DEMO_DATA' }, env).productionLike).toBe(true);
    });

    test('reset scope consists only of explicit deterministic ObjectIds', () => {
        for (const [entity, keys] of Object.entries(RESET_ENTITY_KEYS)) {
            expect(keys.length).toBeGreaterThan(0);
            const ids = knownSeedIds(entity as keyof typeof RESET_ENTITY_KEYS);
            expect(ids).toHaveLength(keys.length);
            expect(ids.every(id => mongoose.Types.ObjectId.isValid(id))).toBe(true);
        }
    });

    test('seed notification policy cannot create pending public broadcast delivery work', () => {
        expect(NOTIFICATION_SEED_POLICY).toEqual({ status: 'sent', createDeliveryRows: false, pendingPublicBroadcast: false });
    });

    test('credential write shape contains only the project password hash field', () => {
        const value = credentialDocument('$argon2id$demo-hash');
        expect(value).toEqual({ password_hash: '$argon2id$demo-hash' });
        expect(value).not.toHaveProperty('password');
        expect(value).not.toHaveProperty('pin');
    });

    test('all doctor fixtures receive required public visibility flags', () => {
        expect(DOCTOR_NAMES).toHaveLength(24);
        expect(DOCTOR_PUBLIC_VISIBILITY).toEqual({ status: 'active', verification_status: 'verified', license_verified: true });
    });

    test('availability fixture periods are ordered, non-overlapping, and valid', () => {
        expect(AVAILABILITY_PATTERNS.every(validAvailabilityPeriods)).toBe(true);
        expect(validAvailabilityPeriods([{ start_time: '13:00', end_time: '12:00' }])).toBe(false);
        expect(validAvailabilityPeriods([{ start_time: '08:00', end_time: '12:00' }, { start_time: '11:00', end_time: '14:00' }])).toBe(false);
    });
});
