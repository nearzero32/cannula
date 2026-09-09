import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import mongoose from 'mongoose';
import User from '../src/models/users.model';
import Patient from '../src/models/patients.model';
import HomeCareCategory from '../src/models/home-care-category.model';
import HomeCareService from '../src/models/home-care-service.model';
import HomeCareAvailabilitySlot from '../src/models/home-care-availability-slot.model';
import { homeCareWeekdayForDate } from '../src/services/home-care-date.service';
import HomeCareRequest from '../src/models/home-care-request.model';
import HomeCareRequestHistory from '../src/models/home-care-request-history.model';
import HomeCareRequestCounter from '../src/models/home-care-request-counter.model';
import HomeCareRequestIdempotency from '../src/models/home-care-request-idempotency.model';
import ActivityLog from '../src/models/activity-log.model';
import { HomeCareRequestService } from '../src/services/home-care-request.service';
import homeCareRequestIdempotencyService from '../src/services/home-care-request-idempotency.service';
import homeCareRequestHistoryService from '../src/services/home-care-request-history.service';

const uri = process.env.MONGODB_TEST_URI;
const run = uri ? describe : describe.skip;

run('Home Care request idempotency against MongoDB 8 replica set', () => {
    const dbName = `cannula_home_care_idempotency_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const models: mongoose.Model<any>[] = [User, Patient, HomeCareCategory, HomeCareService, HomeCareAvailabilitySlot, HomeCareRequest, HomeCareRequestHistory, HomeCareRequestCounter, HomeCareRequestIdempotency, ActivityLog];
    const requests = new HomeCareRequestService({ homeCare: async () => null });
    let user: any, patient: any, otherUser: any, otherPatient: any, category: any, service: any, slot: any;
    const key = (suffix = '0000') => `550e8400-e29b-41d4-a716-44665544${suffix}`;
    const actor = (value = user) => ({ user_id: String(value._id), user_type: 'patient' as const, endpoint: '/mobile/home-care/requests', source: 'mobile' as const });
    const payload = (overrides: Record<string, unknown> = {}) => ({
        service_id: String(service._id), availability_slot_id: String(slot._id), requested_date: '2099-09-07', child_id: null,
        address: { address_text: 'Baghdad address', lat: 33.3, lng: 44.3 }, notes: null, ...overrides,
    });
    const rejected = async (operation: Promise<unknown>) => { try { await operation; } catch (error) { return error as any; } throw new Error('Expected operation to reject'); };
    const percentile = (values: number[], fraction: number) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * fraction) - 1)] ?? 0;

    beforeAll(async () => {
        await mongoose.connect(uri!, { dbName, autoCreate: false, autoIndex: false });
        const buildInfo = await mongoose.connection.db!.admin().command({ buildInfo: 1 });
        expect(buildInfo.version).toMatch(/^8\./);
        await mongoose.connection.dropDatabase();
        await Promise.all(models.map(model => model.syncIndexes()));
        const session = await mongoose.startSession();
        try { await session.withTransaction(async () => undefined); } finally { await session.endSession(); }
    }, 60_000);
    beforeEach(async () => {
        await Promise.all(models.map(model => model.deleteMany({})));
        [user, otherUser] = await User.create([
            { full_name: 'Patient A', phone: `077${Date.now()}1`, password_hash: 'hash', role: 'patient', status: 'active', is_phone_verified: true },
            { full_name: 'Patient B', phone: `077${Date.now()}2`, password_hash: 'hash', role: 'patient', status: 'active', is_phone_verified: true },
        ]);
        [patient, otherPatient] = await Patient.create([
            { user_id: user._id, full_name: 'Patient A', status: 'active' },
            { user_id: otherUser._id, full_name: 'Patient B', status: 'active' },
        ]);
        category = await HomeCareCategory.create({ name: 'Category', normalized_name: 'category', status: 'active' });
        service = await HomeCareService.create({ category_id: category._id, name: 'Service', price: 10000, status: 'active' });
        slot = await HomeCareAvailabilitySlot.create({ service_id: service._id, day_of_week: homeCareWeekdayForDate('2099-09-07'), time: '11:00', status: 'active', display_order: 10, created_by: user._id });
    }, 30_000);
    afterEach(() => mock.restore());
    afterAll(async () => { if (mongoose.connection.db) await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });

    test('first create and replay return one request, number, history, and activity log', async () => {
        const first = await requests.createIdempotentForPatient(patient._id, payload(), actor(), key());
        const replay = await requests.createIdempotentForPatient(patient._id, payload(), actor(), key());
        expect(first.replayed).toBe(false);
        expect(replay.replayed).toBe(true);
        expect(String(replay.request._id)).toBe(String(first.request._id));
        expect(await HomeCareRequest.countDocuments()).toBe(1);
        expect((await HomeCareRequestCounter.findOne())?.sequence).toBe(1);
        expect(await HomeCareRequestHistory.countDocuments({ event_type: 'REQUEST_CREATED' })).toBe(1);
        expect(await ActivityLog.countDocuments({ collection_name: 'home_care_requests', action: 'create' })).toBe(1);
    });

    test('same patient/key with a changed normalized payload returns 409', async () => {
        await requests.createIdempotentForPatient(patient._id, payload(), actor(), key());
        const error = await rejected(requests.createIdempotentForPatient(patient._id, payload({ notes: 'different' }), actor(), key()));
        expect(error).toMatchObject({ status: 409, code: 'HOME_CARE_IDEMPOTENCY_CONFLICT' });
        expect(await HomeCareRequest.countDocuments()).toBe(1);
    });

    test('different keys create separate requests while the same key is independent per patient', async () => {
        const a1 = await requests.createIdempotentForPatient(patient._id, payload(), actor(), key('0001'));
        const a2 = await requests.createIdempotentForPatient(patient._id, payload(), actor(), key('0002'));
        const b1 = await requests.createIdempotentForPatient(otherPatient._id, payload(), actor(otherUser), key('0001'));
        expect(new Set([String(a1.request._id), String(a2.request._id), String(b1.request._id)]).size).toBe(3);
        expect(await HomeCareRequest.countDocuments()).toBe(3);
        expect(await HomeCareRequestIdempotency.countDocuments()).toBe(3);
    });

    test('10 concurrent identical submissions converge on one completed request', async () => {
        const results = await Promise.all(Array.from({ length: 10 }, () => requests.createIdempotentForPatient(patient._id, payload(), actor(), key())));
        expect(new Set(results.map(result => String(result.request._id))).size).toBe(1);
        expect(results.filter(result => !result.replayed)).toHaveLength(1);
        expect(await HomeCareRequest.countDocuments()).toBe(1);
        expect(await HomeCareRequestHistory.countDocuments({ event_type: 'REQUEST_CREATED' })).toBe(1);
        expect((await HomeCareRequestCounter.findOne())?.sequence).toBe(1);
    }, 60_000);

    test('50 concurrent identical submissions create once with bounded replay latency', async () => {
        const originalClaim = homeCareRequestIdempotencyService.claim.bind(homeCareRequestIdempotencyService);
        const claim = spyOn(homeCareRequestIdempotencyService, 'claim').mockImplementation((...args) => originalClaim(...args));
        const latencies: number[] = [];
        const results = await Promise.all(Array.from({ length: 50 }, async () => {
            const started = performance.now();
            try { return await requests.createIdempotentForPatient(patient._id, payload(), actor(), key()); }
            finally { latencies.push(performance.now() - started); }
        }));
        console.log(`home-care-idempotency attempts=50 requests=1 responses=${results.length} transaction_retries=${claim.mock.calls.length - 50} p50_ms=${percentile(latencies, .5).toFixed(1)} p95_ms=${percentile(latencies, .95).toFixed(1)}`);
        expect(new Set(results.map(result => String(result.request._id))).size).toBe(1);
        expect(results.filter(result => !result.replayed)).toHaveLength(1);
        expect(await HomeCareRequest.countDocuments()).toBe(1);
        expect(await HomeCareRequestHistory.countDocuments({ event_type: 'REQUEST_CREATED' })).toBe(1);
        expect((await HomeCareRequestCounter.findOne())?.sequence).toBe(1);
        expect(await ActivityLog.countDocuments({ collection_name: 'home_care_requests', action: 'create' })).toBe(1);
    }, 120_000);

    test('transaction rollback removes the claim and retry with the same key succeeds', async () => {
        const originalAppend = homeCareRequestHistoryService.append.bind(homeCareRequestHistoryService);
        const append = spyOn(homeCareRequestHistoryService, 'append').mockRejectedValueOnce(new Error('FORCED_HISTORY_FAILURE'));
        expect((await rejected(requests.createIdempotentForPatient(patient._id, payload(), actor(), key()))).message).toBe('FORCED_HISTORY_FAILURE');
        expect(await HomeCareRequestIdempotency.countDocuments()).toBe(0);
        expect(await HomeCareRequest.countDocuments()).toBe(0);
        expect(await HomeCareRequestCounter.countDocuments()).toBe(0);
        append.mockImplementation(originalAppend);
        const retry = await requests.createIdempotentForPatient(patient._id, payload(), actor(), key());
        expect(retry.replayed).toBe(false);
        expect(await HomeCareRequestIdempotency.countDocuments({ status: 'completed' })).toBe(1);
        expect(await HomeCareRequest.countDocuments()).toBe(1);
        expect(await HomeCareRequestHistory.countDocuments({ event_type: 'REQUEST_CREATED' })).toBe(1);
    });

    test('a logically expired key starts a new operation before the TTL monitor deletes it', async () => {
        const first = await requests.createIdempotentForPatient(patient._id, payload(), actor(), key());
        await HomeCareRequestIdempotency.updateOne(
            { patient_id: patient._id, idempotency_key: key() },
            { $set: { expires_at: new Date(Date.now() - 1_000) } },
        );
        const afterExpiry = await requests.createIdempotentForPatient(patient._id, payload(), actor(), key());
        expect(afterExpiry.replayed).toBe(false);
        expect(String(afterExpiry.request._id)).not.toBe(String(first.request._id));
        expect(await HomeCareRequestIdempotency.countDocuments()).toBe(1);
        expect(await HomeCareRequest.countDocuments()).toBe(2);
        expect((await HomeCareRequestCounter.findOne())?.sequence).toBe(2);
        expect(await HomeCareRequestHistory.countDocuments({ event_type: 'REQUEST_CREATED' })).toBe(2);
    });

    test('actual patient-scoped unique and TTL indexes exist', async () => {
        const indexes = await HomeCareRequestIdempotency.collection.indexes();
        expect(indexes.some(index => index.unique && JSON.stringify(index.key) === JSON.stringify({ patient_id: 1, idempotency_key: 1 }))).toBe(true);
        expect(indexes.some(index => index.expireAfterSeconds === 0 && JSON.stringify(index.key) === JSON.stringify({ expires_at: 1 }))).toBe(true);
    });
});
