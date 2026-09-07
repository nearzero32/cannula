import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import mongoose from 'mongoose';
import User from '../src/models/users.model';
import Patient from '../src/models/patients.model';
import HomeCareCategory from '../src/models/home-care-category.model';
import HomeCareService from '../src/models/home-care-service.model';
import HomeCareAvailabilitySlot from '../src/models/home-care-availability-slot.model';
import HomeCareRequest from '../src/models/home-care-request.model';
import HomeCareRequestHistory from '../src/models/home-care-request-history.model';
import HomeCareRequestCounter from '../src/models/home-care-request-counter.model';
import homeCareAvailabilityService, { HomeCareAvailabilityService } from '../src/services/home-care-availability.service';
import { HomeCareRequestService } from '../src/services/home-care-request.service';
import homeCareServiceService from '../src/services/home-care-service.service';
import homeCareRequestHistoryService from '../src/services/home-care-request-history.service';
import { formatHomeCareRequestForDashboard, formatHomeCareRequestForMobile } from '../src/services/home-care-request.formatter';
import { assertHomeCareSlotLeadTime } from '../src/services/home-care-date.service';

const uri = process.env.MONGODB_TEST_URI;
const run = uri ? describe : describe.skip;
run('Home Care availability against MongoDB replica set', () => {
    const dbName = `cannula_home_care_availability_${Date.now()}`;
    let user: any, patient: any, category: any, serviceA: any, serviceB: any;
    const availability = new HomeCareAvailabilityService();
    const requests = new HomeCareRequestService({ homeCare: async () => null });
    const rejected = async (operation: Promise<unknown>) => { try { await operation; } catch (error) { return error as any; } throw new Error('Expected operation to reject'); };
    const actor = () => ({ user_id: String(user._id), user_type: 'admin', source: 'dashboard' });
    const patientActor = (userId = String(user._id)) => ({ user_id: userId, user_type: 'patient' as const, endpoint: '/mobile/home-care/requests', source: 'mobile' as const });
    const input = (slotId: unknown, date = '2099-09-07') => ({ service_id: String(serviceA._id), availability_slot_id: String(slotId), requested_date: date, address: { address_text: 'Baghdad address', lat: 33.3, lng: 44.3 } });
    const percentile = (values: number[], fraction: number) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * fraction) - 1)] ?? 0;
    const collections: mongoose.Model<any>[] = [User, Patient, HomeCareCategory, HomeCareService, HomeCareAvailabilitySlot, HomeCareRequest, HomeCareRequestHistory, HomeCareRequestCounter];
    beforeAll(async () => {
        await mongoose.connect(uri!, { dbName, autoCreate: false, autoIndex: false });
        await mongoose.connection.dropDatabase();
        await Promise.all(collections.map(model => model.syncIndexes()));
        const session = await mongoose.startSession();
        try { await session.withTransaction(async () => undefined); } finally { await session.endSession(); }
    }, 60_000);
    beforeEach(async () => {
        await Promise.all(collections.map(model => model.deleteMany({})));
        user = await User.create({ full_name: 'Patient', phone: `077${Date.now()}`, password_hash: 'hash', role: 'patient', status: 'active', is_phone_verified: true });
        patient = await Patient.create({ user_id: user._id, full_name: 'Patient', status: 'active' });
        category = await HomeCareCategory.create({ name: 'Category', normalized_name: 'category', status: 'active' });
        [serviceA, serviceB] = await HomeCareService.create([{ category_id: category._id, name: 'A', price: 10000, status: 'active' }, { category_id: category._id, name: 'B', price: 12000, status: 'active' }]);
    }, 30_000);
    afterEach(() => mock.restore());
    afterAll(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });

    test('unique time is per service and bulk replacement safely reuses/deactivates', async () => {
        await availability.create(String(serviceA._id), { time: '09:00' }, actor());
        await availability.create(String(serviceB._id), { time: '09:00' }, actor());
        let duplicateError: any;
        try { await availability.create(String(serviceA._id), { time: '09:00' }, actor()); }
        catch (error) { duplicateError = error; }
        expect(duplicateError).toMatchObject({ status: 409 });
        const slots = await availability.replace(String(serviceA._id), ['11:00', '14:00'], actor());
        expect(slots.filter(x => x.status === 'active').map(x => x.time)).toEqual(['11:00', '14:00']);
        expect(await HomeCareAvailabilitySlot.countDocuments({ service_id: serviceA._id, time: '09:00', status: 'inactive' })).toBe(1);
    });

    test('request stores slot relationship and immutable time across edit/deactivation', async () => {
        const slot = await availability.create(String(serviceA._id), { time: '11:00' }, actor());
        const request = await requests.createForPatient(patient._id, { service_id: String(serviceA._id), availability_slot_id: String(slot._id), requested_date: '2099-09-07', address: { address_text: 'Baghdad address', lat: 33.3, lng: 44.3 } }, { user_id: String(user._id), user_type: 'patient', endpoint: '/mobile/home-care/requests', source: 'mobile' });
        expect(String(request.availability_slot_id)).toBe(String(slot._id));
        expect(request.preferred_time).toBe('11:00');
        await availability.update(String(serviceA._id), String(slot._id), { time: '12:00' }, actor());
        await availability.archive(String(serviceA._id), String(slot._id), actor());
        const historical = await HomeCareRequest.findById(request._id).lean();
        expect(historical?.preferred_time).toBe('11:00');
        expect(String(historical?.availability_slot_id)).toBe(String(slot._id));
        expect(await rejected(availability.requireAvailableForRequest(String(serviceA._id), String(slot._id)))).toMatchObject({ code: 'HOME_CARE_SLOT_NOT_AVAILABLE' });
    });

    test('service/category inactivity hides mobile availability', async () => {
        await availability.create(String(serviceA._id), { time: '11:00' }, actor());
        expect(await availability.listForMobile(String(serviceA._id), '2099-09-07')).toHaveLength(1);
        await HomeCareCategory.updateOne({ _id: category._id }, { $set: { status: 'inactive' } });
        expect(await rejected(availability.listForMobile(String(serviceA._id), '2099-09-07'))).toMatchObject({ status: 404 });
        await HomeCareCategory.updateOne({ _id: category._id }, { $set: { status: 'active' } });
        await HomeCareService.updateOne({ _id: serviceA._id }, { $set: { status: 'inactive' } });
        expect(await rejected(availability.listForMobile(String(serviceA._id), '2099-09-07'))).toMatchObject({ status: 404 });
    });

    test('a previously fetched slot cannot silently adopt a later dashboard time edit', async () => {
        const slot = await availability.create(String(serviceA._id), { time: '09:00' }, actor());
        const fetched = await availability.listForMobile(String(serviceA._id), '2099-09-07');
        expect(fetched[0]?.time).toBe('09:00');
        await availability.update(String(serviceA._id), String(slot._id), { time: '10:00' }, actor());
        expect(await rejected(requests.createForPatient(patient._id, {
            service_id: String(serviceA._id), availability_slot_id: String(slot._id), requested_date: '2099-09-07',
            address: { address_text: 'Baghdad address', lat: 33.3, lng: 44.3 },
        }, { user_id: String(user._id), user_type: 'patient', endpoint: '/mobile/home-care/requests', source: 'mobile' })))
            .toMatchObject({ code: 'HOME_CARE_SLOT_NOT_AVAILABLE' });
    });

    test('service is revalidated after precheck and before transactional request creation', async () => {
        const slot = await availability.create(String(serviceA._id), { time: '11:00' }, actor());
        const original = homeCareServiceService.getActiveById.bind(homeCareServiceService);
        let release!: () => void;
        let observed!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const prechecked = new Promise<void>(resolve => { observed = resolve; });
        spyOn(homeCareServiceService, 'getActiveById').mockImplementation(async id => {
            const result = await original(id);
            observed();
            await gate;
            return result;
        });
        const booking = requests.createForPatient(patient._id, {
            service_id: String(serviceA._id), availability_slot_id: String(slot._id), requested_date: '2099-09-07',
            address: { address_text: 'Baghdad address', lat: 33.3, lng: 44.3 },
        }, { user_id: String(user._id), user_type: 'patient', endpoint: '/mobile/home-care/requests', source: 'mobile' });
        await prechecked;
        await HomeCareService.updateOne({ _id: serviceA._id }, { $set: { status: 'inactive' } });
        release();
        expect(await rejected(booking)).toMatchObject({ code: 'HOME_CARE_SERVICE_NOT_AVAILABLE' });
        expect(await HomeCareRequest.countDocuments()).toBe(0);
    });

    test('category is revalidated after precheck and before transactional request creation', async () => {
        const slot = await availability.create(String(serviceA._id), { time: '11:00' }, actor());
        const original = homeCareServiceService.getActiveById.bind(homeCareServiceService);
        let release!: () => void;
        let observed!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const prechecked = new Promise<void>(resolve => { observed = resolve; });
        spyOn(homeCareServiceService, 'getActiveById').mockImplementation(async (id, session) => {
            const result = await original(id, session);
            if (!session) { observed(); await gate; }
            return result;
        });
        const booking = requests.createForPatient(patient._id, input(slot._id), patientActor());
        await prechecked;
        await HomeCareCategory.updateOne({ _id: category._id }, { $set: { status: 'inactive' } });
        release();
        expect(await rejected(booking)).toMatchObject({ code: 'HOME_CARE_SERVICE_NOT_AVAILABLE' });
        expect(await HomeCareRequest.countDocuments()).toBe(0);
    });

    test('disable versus booking serializes safely across 50 real races', async () => {
        const slot = await availability.create(String(serviceA._id), { time: '11:00' }, actor());
        let successes = 0;
        for (let iteration = 0; iteration < 50; iteration += 1) {
            await HomeCareAvailabilitySlot.updateOne({ _id: slot._id }, { $set: { status: 'active' } });
            const [disabled, booked] = await Promise.allSettled([
                HomeCareAvailabilitySlot.updateOne({ _id: slot._id, status: 'active' }, { $set: { status: 'inactive' } }),
                requests.createForPatient(patient._id, input(slot._id, `2099-10-${String((iteration % 28) + 1).padStart(2, '0')}`), patientActor()),
            ]);
            expect(disabled.status).toBe('fulfilled');
            if (booked.status === 'fulfilled') {
                successes += 1;
                expect(booked.value.preferred_time).toBe('11:00');
                expect(String(booked.value.availability_slot_id)).toBe(String(slot._id));
            } else {
                expect(booked.reason).toMatchObject({ code: 'HOME_CARE_SLOT_NOT_AVAILABLE' });
            }
            expect((await HomeCareAvailabilitySlot.findById(slot._id))?.status).toBe('inactive');
        }
        expect(await HomeCareRequest.countDocuments()).toBe(successes);
        expect(await HomeCareRequestHistory.countDocuments({ event_type: 'REQUEST_CREATED' })).toBe(successes);
        console.log(`availability-disable-race iterations=50 booking_success=${successes} booking_rejected=${50 - successes}`);
    }, 120_000);

    test('time edit versus stale booking preserves the selected snapshot across 50 real races', async () => {
        let current = await availability.create(String(serviceA._id), { time: '09:00' }, actor());
        let successes = 0;
        for (let iteration = 0; iteration < 50; iteration += 1) {
            const selectedId = String(current._id);
            const selectedTime = current.time;
            const nextTime = selectedTime === '09:00' ? '10:00' : '09:00';
            const [edited, booked] = await Promise.allSettled([
                availability.update(String(serviceA._id), selectedId, { time: nextTime }, actor()),
                requests.createForPatient(patient._id, input(selectedId, `2099-11-${String((iteration % 28) + 1).padStart(2, '0')}`), patientActor()),
            ]);
            expect(edited.status).toBe('fulfilled');
            current = (edited as PromiseFulfilledResult<any>).value;
            expect(current.time).toBe(nextTime);
            expect(String(current._id)).not.toBe(selectedId);
            if (booked.status === 'fulfilled') {
                successes += 1;
                expect(booked.value.preferred_time).toBe(selectedTime);
                expect(String(booked.value.availability_slot_id)).toBe(selectedId);
            } else {
                expect(booked.reason).toMatchObject({ code: 'HOME_CARE_SLOT_NOT_AVAILABLE' });
            }
        }
        expect(await HomeCareRequest.countDocuments()).toBe(successes);
        expect(await HomeCareRequestHistory.countDocuments({ event_type: 'REQUEST_CREATED' })).toBe(successes);
        console.log(`availability-edit-race iterations=50 booking_success=${successes} booking_rejected=${50 - successes}`);
    }, 120_000);

    test('50 different patients can book one recurring slot without capacity rejection', async () => {
        const slot = await availability.create(String(serviceA._id), { time: '11:00' }, actor());
        const originalClaim = homeCareAvailabilityService.claimAvailableForRequest.bind(homeCareAvailabilityService);
        const claim = spyOn(homeCareAvailabilityService, 'claimAvailableForRequest').mockImplementation((...args) => originalClaim(...args));
        const latencies: number[] = [];
        const attempts = Array.from({ length: 50 }, (_, index) => {
            const started = performance.now();
            const patientId = new mongoose.Types.ObjectId();
            const userId = String(new mongoose.Types.ObjectId());
            return requests.createForPatient(patientId, input(slot._id, `2099-12-${String((index % 28) + 1).padStart(2, '0')}`), patientActor(userId))
                .finally(() => latencies.push(performance.now() - started));
        });
        const results = await Promise.allSettled(attempts);
        const successes = results.filter(result => result.status === 'fulfilled');
        const errors = results.filter(result => result.status === 'rejected');
        console.log(`availability-contention attempts=50 success=${successes.length} errors=${errors.length} transaction_retries=${claim.mock.calls.length - 50} p50_ms=${percentile(latencies, .5).toFixed(1)} p95_ms=${percentile(latencies, .95).toFixed(1)}`);
        expect(errors).toHaveLength(0);
        expect(successes).toHaveLength(50);
        expect(await HomeCareRequest.countDocuments()).toBe(50);
        expect(await HomeCareRequestHistory.countDocuments({ event_type: 'REQUEST_CREATED' })).toBe(50);
        expect(new Set((await HomeCareRequest.find().select('request_number').lean()).map(item => item.request_number)).size).toBe(50);
        expect((await HomeCareAvailabilitySlot.findById(slot._id).select('+selection_version'))?.selection_version).toBe(50);
    }, 120_000);

    test('48 concurrent bookings distributed over 24 slots establish the shared-counter baseline', async () => {
        const slots = await HomeCareAvailabilitySlot.insertMany(Array.from({ length: 24 }, (_, index) => ({
            service_id: serviceA._id, time: `${String(index).padStart(2, '0')}:00`, status: 'active', display_order: (index + 1) * 10,
        })));
        const originalClaim = homeCareAvailabilityService.claimAvailableForRequest.bind(homeCareAvailabilityService);
        const claim = spyOn(homeCareAvailabilityService, 'claimAvailableForRequest').mockImplementation((...args) => originalClaim(...args));
        const latencies: number[] = [];
        const results = await Promise.allSettled(Array.from({ length: 48 }, (_, index) => {
            const started = performance.now();
            return requests.createForPatient(new mongoose.Types.ObjectId(), input(slots[index % slots.length]._id, `2099-12-${String((index % 28) + 1).padStart(2, '0')}`), patientActor(String(new mongoose.Types.ObjectId())))
                .finally(() => latencies.push(performance.now() - started));
        }));
        console.log(`distributed-contention attempts=48 success=${results.filter(item => item.status === 'fulfilled').length} errors=${results.filter(item => item.status === 'rejected').length} transaction_retries=${claim.mock.calls.length - 48} p50_ms=${percentile(latencies, .5).toFixed(1)} p95_ms=${percentile(latencies, .95).toFixed(1)}`);
        expect(results.filter(item => item.status === 'rejected')).toHaveLength(0);
        expect(await HomeCareRequest.countDocuments()).toBe(48);
        expect(await HomeCareRequestHistory.countDocuments({ event_type: 'REQUEST_CREATED' })).toBe(48);
    }, 120_000);

    test('same service, slot, date, and time permits multiple requests because capacity is not implemented', async () => {
        const slot = await availability.create(String(serviceA._id), { time: '11:00' }, actor());
        const results = await Promise.allSettled(Array.from({ length: 10 }, () => requests.createForPatient(
            new mongoose.Types.ObjectId(), input(slot._id, '2099-12-20'), patientActor(String(new mongoose.Types.ObjectId()))
        )));
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(10);
        expect(await HomeCareRequest.countDocuments()).toBe(10);
        expect(await HomeCareRequestHistory.countDocuments({ event_type: 'REQUEST_CREATED' })).toBe(10);
    }, 60_000);

    test('two identical concurrent submissions create two consistent requests without idempotency', async () => {
        const slot = await availability.create(String(serviceA._id), { time: '11:00' }, actor());
        const results = await Promise.all([
            requests.createForPatient(patient._id, input(slot._id), patientActor()),
            requests.createForPatient(patient._id, input(slot._id), patientActor()),
        ]);
        expect(results).toHaveLength(2);
        expect(new Set(results.map(item => item.request_number)).size).toBe(2);
        expect(await HomeCareRequestHistory.countDocuments({ event_type: 'REQUEST_CREATED' })).toBe(2);
    });

    test('legacy requests without availability_slot_id format, list, and cancel safely', async () => {
        const legacy = await HomeCareRequest.create({
            request_number: 'HC-LEGACY-000001', patient_id: patient._id, category_id: category._id, service_id: serviceA._id,
            service_name: serviceA.name, service_price: serviceA.price, requested_date: new Date('2099-09-07T00:00:00Z'), preferred_time: '08:30',
            address: { address_text: 'Baghdad legacy address', lat: 33.3, lng: 44.3 }, status: 'pending',
            dispatch: { status: 'OPEN', mode: 'OPEN_POOL', nurse_id: null, assigned_at: null, assigned_by_user_id: null, version: 0 },
        });
        expect(formatHomeCareRequestForMobile(legacy).availability_slot_id).toBeNull();
        expect(formatHomeCareRequestForDashboard(legacy).preferred_time).toBe('08:30');
        expect((await requests.listForPatient(patient._id, { page: 1, limit: 10 })).count).toBe(1);
        const cancelled = await requests.cancelForPatient(patient._id, String(legacy._id), 'legacy cancellation', patientActor());
        expect(cancelled.status).toBe('cancelled');
        expect(await HomeCareRequestHistory.countDocuments({ request_id: legacy._id, event_type: 'REQUEST_CANCELLED' })).toBe(1);
    });

    test('GET lead-time boundary uses one inclusive Baghdad rule for 10:29, 10:30, and 10:31', async () => {
        await HomeCareAvailabilitySlot.insertMany(['10:29', '10:30', '10:31'].map((time, index) => ({ service_id: serviceA._id, time, status: 'active', display_order: (index + 1) * 10 })));
        const now = new Date('2026-09-07T07:00:00.000Z');
        const visible = await availability.listForMobile(String(serviceA._id), '2026-09-07', now);
        expect(visible.map(item => item.time)).toEqual(['10:30', '10:31']);
        expect(() => assertHomeCareSlotLeadTime('2026-09-07', '10:29', now)).toThrow();
        expect(() => assertHomeCareSlotLeadTime('2026-09-07', '10:30', now)).not.toThrow();
        expect(() => assertHomeCareSlotLeadTime('2026-09-07', '10:31', now)).not.toThrow();
    });

    test('history failure rolls back request, number allocation, history, and slot CAS touch', async () => {
        const slot = await availability.create(String(serviceA._id), { time: '11:00' }, actor());
        spyOn(homeCareRequestHistoryService, 'append').mockRejectedValue(new Error('FORCED_HISTORY_FAILURE'));
        expect((await rejected(requests.createForPatient(patient._id, input(slot._id), patientActor()))).message).toBe('FORCED_HISTORY_FAILURE');
        expect(await HomeCareRequest.countDocuments()).toBe(0);
        expect(await HomeCareRequestHistory.countDocuments()).toBe(0);
        expect(await HomeCareRequestCounter.countDocuments()).toBe(0);
        expect((await HomeCareAvailabilitySlot.findById(slot._id).select('+selection_version'))?.selection_version).toBe(0);
    });

    test('bulk replacement is atomic to concurrent readers and preserves deterministic identities/order', async () => {
        const original = await availability.replace(String(serviceA._id), ['09:00', '11:00', '14:00'], actor());
        const reused = original.find(item => item.time === '11:00')!;
        const observations: string[][] = [];
        const replacement = availability.replace(String(serviceA._id), ['11:00', '16:00'], actor());
        const reads = Array.from({ length: 30 }, async () => {
            const rows = await availability.listForMobile(String(serviceA._id), '2099-09-07');
            observations.push(rows.map(item => item.time));
        });
        await Promise.all([replacement, ...reads]);
        for (const times of observations) expect([['09:00', '11:00', '14:00'], ['11:00', '16:00']]).toContainEqual(times);
        const final = await availability.listForDashboard(String(serviceA._id));
        expect(final.filter(item => item.status === 'active').map(item => item.time)).toEqual(['11:00', '16:00']);
        expect(String(final.find(item => item.time === '11:00')?._id)).toBe(String(reused._id));
        expect(final.find(item => item.time === '11:00')?.display_order).toBe(10);
        expect(final.find(item => item.time === '16:00')?.display_order).toBe(20);
        expect(final.filter(item => ['09:00', '14:00'].includes(item.time)).every(item => item.status === 'inactive')).toBe(true);
    }, 60_000);

    test('actual indexes support uniqueness, slot relationship lookup, and indexed mobile scan', async () => {
        await HomeCareAvailabilitySlot.insertMany(Array.from({ length: 24 }, (_, index) => ({
            service_id: serviceA._id, time: `${String(index).padStart(2, '0')}:00`, status: 'active', display_order: (index + 1) * 10,
        })));
        const slotIndexes = await HomeCareAvailabilitySlot.collection.indexes();
        const requestIndexes = await HomeCareRequest.collection.indexes();
        expect(slotIndexes.some(index => index.unique && JSON.stringify(index.key) === JSON.stringify({ service_id: 1, time: 1 }))).toBe(true);
        expect(slotIndexes.some(index => JSON.stringify(index.key) === JSON.stringify({ service_id: 1, status: 1, display_order: 1 }))).toBe(true);
        expect(requestIndexes.some(index => JSON.stringify(index.key) === JSON.stringify({ availability_slot_id: 1 }))).toBe(true);
        const explain: any = await HomeCareAvailabilitySlot.find({ service_id: serviceA._id, status: 'active' })
            .sort({ display_order: 1, time: 1, _id: 1 }).hint({ service_id: 1, status: 1, display_order: 1 }).explain('executionStats');
        const stages = JSON.stringify(explain.queryPlanner.winningPlan);
        expect(stages).toContain('IXSCAN');
        expect(explain.executionStats.totalDocsExamined).toBe(24);
    });

    test('availability read latency remains bounded for 5, 10, and 24 slots', async () => {
        for (const count of [5, 10, 24]) {
            await HomeCareAvailabilitySlot.deleteMany({ service_id: serviceA._id });
            await HomeCareAvailabilitySlot.insertMany(Array.from({ length: count }, (_, index) => ({
                service_id: serviceA._id, time: `${String(index).padStart(2, '0')}:00`, status: 'active', display_order: (index + 1) * 10,
            })));
            const samples: number[] = [];
            for (let sample = 0; sample < 20; sample += 1) {
                const started = performance.now();
                expect(await availability.listForMobile(String(serviceA._id), '2099-09-07')).toHaveLength(count);
                samples.push(performance.now() - started);
            }
            const average = samples.reduce((sum, value) => sum + value, 0) / samples.length;
            console.log(`availability-read slots=${count} avg_ms=${average.toFixed(1)} p95_ms=${percentile(samples, .95).toFixed(1)}`);
            expect(percentile(samples, .95)).toBeLessThan(500);
        }
    }, 60_000);
});
