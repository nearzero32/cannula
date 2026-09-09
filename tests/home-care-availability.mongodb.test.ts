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
import homeCareAvailabilityService, { HomeCareAvailabilityService, type HomeCareWeeklyScheduleDay } from '../src/services/home-care-availability.service';
import { HomeCareRequestService } from '../src/services/home-care-request.service';
import { HOME_CARE_WEEKDAYS, type HomeCareWeekday } from '../src/interfaces/home-care.interface';
import { homeCareWeekdayForDate } from '../src/services/home-care-date.service';
import { formatHomeCareRequestForMobile } from '../src/services/home-care-request.formatter';
import { migrateHomeCareWeeklyAvailability } from '../src/migrations/home-care-weekly-availability.migration';

const uri = process.env.MONGODB_TEST_URI;
const run = uri ? describe : describe.skip;
run('Home Care weekly availability against MongoDB replica set', () => {
    const dbName = `cannula_home_care_weekly_${Date.now()}`;
    let user: any, patient: any, category: any, serviceA: any, serviceB: any;
    const availability = new HomeCareAvailabilityService();
    const requests = new HomeCareRequestService({ homeCare: async () => null });
    const actor = () => ({ user_id: String(user._id), user_type: 'admin', source: 'dashboard' });
    const patientActor = () => ({ user_id: String(user._id), user_type: 'patient' as const, endpoint: '/mobile/home-care/requests', source: 'mobile' as const });
    const week = (overrides: Partial<Record<HomeCareWeekday, string[]>> = {}): HomeCareWeeklyScheduleDay[] =>
        HOME_CARE_WEEKDAYS.map(day => ({ day_of_week: day, times: overrides[day] ?? [] }));
    const requestInput = (slotId: unknown, date: string) => ({ service_id: String(serviceA._id), availability_slot_id: String(slotId), requested_date: date, address: { address_text: 'Baghdad address', lat: 33.3, lng: 44.3 } });
    const rejected = async (operation: Promise<unknown>) => { try { await operation; } catch (error) { return error as any; } throw new Error('Expected operation to reject'); };
    const models: mongoose.Model<any>[] = [User, Patient, HomeCareCategory, HomeCareService, HomeCareAvailabilitySlot, HomeCareRequest, HomeCareRequestHistory, HomeCareRequestCounter];

    beforeAll(async () => {
        await mongoose.connect(uri!, { dbName, autoCreate: false, autoIndex: false });
        await mongoose.connection.dropDatabase();
        await Promise.all(models.map(model => model.syncIndexes()));
        const session = await mongoose.startSession();
        try { await session.withTransaction(async () => undefined); } finally { await session.endSession(); }
    }, 60_000);
    beforeEach(async () => {
        await Promise.all(models.map(model => model.deleteMany({})));
        user = await User.create({ full_name: 'Patient', phone: `077${Date.now()}`, password_hash: 'hash', role: 'patient', status: 'active', is_phone_verified: true });
        patient = await Patient.create({ user_id: user._id, full_name: 'Patient', status: 'active' });
        category = await HomeCareCategory.create({ name: 'Category', normalized_name: 'category', status: 'active' });
        [serviceA, serviceB] = await HomeCareService.create([{ category_id: category._id, name: 'A', price: 10000, status: 'active' }, { category_id: category._id, name: 'B', price: 12000, status: 'active' }]);
    }, 30_000);
    afterEach(() => mock.restore());
    afterAll(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });

    test('uniqueness is scoped to service + weekday + time', async () => {
        await HomeCareAvailabilitySlot.create({ service_id: serviceA._id, day_of_week: 'SATURDAY', time: '09:00' });
        await HomeCareAvailabilitySlot.create({ service_id: serviceA._id, day_of_week: 'SUNDAY', time: '09:00' });
        await HomeCareAvailabilitySlot.create({ service_id: serviceB._id, day_of_week: 'SATURDAY', time: '09:00' });
        expect(await rejected(HomeCareAvailabilitySlot.create({ service_id: serviceA._id, day_of_week: 'SATURDAY', time: '09:00' }))).toMatchObject({ code: 11000 });
    });

    test('weekly PUT saves all days, GET returns seven, and a closed weekday is empty', async () => {
        const result = await availability.replaceWeekly(String(serviceA._id), { schedule: week({ SATURDAY: ['09:00', '11:00'], SUNDAY: ['10:00'] }) }, actor());
        expect(result.schedule).toHaveLength(7);
        expect(result.schedule[0]?.times).toEqual(['09:00', '11:00']);
        expect(result.schedule[6]).toEqual({ day_of_week: 'FRIDAY', times: [] });
        expect(await HomeCareAvailabilitySlot.countDocuments({ service_id: serviceA._id, status: 'active' })).toBe(3);
    });

    test('weekly PUT rolls back fully when an upsert fails', async () => {
        await availability.replaceWeekly(String(serviceA._id), { schedule: week({ SATURDAY: ['09:00'], SUNDAY: ['10:00'] }) }, actor());
        const before = await availability.listForDashboard(String(serviceA._id));
        spyOn(HomeCareAvailabilitySlot, 'bulkWrite').mockRejectedValueOnce(new Error('FORCED_WEEKLY_FAILURE'));
        expect((await rejected(availability.replaceWeekly(String(serviceA._id), { schedule: week({ MONDAY: ['12:00'] }) }, actor()))).message).toBe('FORCED_WEEKLY_FAILURE');
        expect(await availability.listForDashboard(String(serviceA._id))).toEqual(before);
    });

    test('weekly PUT preserves unchanged IDs and replaces only changed identities', async () => {
        await availability.replaceWeekly(String(serviceA._id), { schedule: week({
            SATURDAY: ['09:00', '11:00', '14:00'], SUNDAY: ['10:00'],
        }) }, actor());
        const before = await HomeCareAvailabilitySlot.find({ service_id: serviceA._id }).lean();
        const identity = (day: string, time: string) => before.find(row => row.day_of_week === day && row.time === time)!;
        const slotA = identity('SATURDAY', '09:00');
        const slotB = identity('SATURDAY', '11:00');
        const slotC = identity('SATURDAY', '14:00');
        const sunday = identity('SUNDAY', '10:00');
        await availability.replaceWeekly(String(serviceA._id), { schedule: week({
            SATURDAY: ['09:00', '11:00', '16:00'], SUNDAY: ['10:00'],
        }) }, actor());
        const after = await HomeCareAvailabilitySlot.find({ service_id: serviceA._id }).lean();
        const afterIdentity = (day: string, time: string) => after.find(row => row.day_of_week === day && row.time === time)!;
        expect(String(afterIdentity('SATURDAY', '09:00')._id)).toBe(String(slotA._id));
        expect(String(afterIdentity('SATURDAY', '11:00')._id)).toBe(String(slotB._id));
        expect(afterIdentity('SATURDAY', '14:00').status).toBe('inactive');
        expect(String(afterIdentity('SATURDAY', '14:00')._id)).toBe(String(slotC._id));
        expect(afterIdentity('SATURDAY', '16:00').status).toBe('active');
        expect(String(afterIdentity('SATURDAY', '16:00')._id)).not.toBe(String(slotC._id));
        expect(String(afterIdentity('SUNDAY', '10:00')._id)).toBe(String(sunday._id));
    });

    test('replacing Saturday does not corrupt or change Sunday slot identity', async () => {
        await availability.replaceWeekly(String(serviceA._id), { schedule: week({ SATURDAY: ['09:00'], SUNDAY: ['10:00'] }) }, actor());
        const sunday = await HomeCareAvailabilitySlot.findOne({ service_id: serviceA._id, day_of_week: 'SUNDAY', time: '10:00' });
        await availability.replaceWeekly(String(serviceA._id), { schedule: week({ SATURDAY: ['11:00'], SUNDAY: ['10:00'] }) }, actor());
        const sundayAfter = await HomeCareAvailabilitySlot.findOne({ service_id: serviceA._id, day_of_week: 'SUNDAY', time: '10:00' });
        expect(String(sundayAfter?._id)).toBe(String(sunday?._id));
        expect(sundayAfter?.status).toBe('active');
        expect((await HomeCareAvailabilitySlot.findOne({ service_id: serviceA._id, day_of_week: 'SATURDAY', time: '09:00' }))?.status).toBe('inactive');
    });

    test('mobile dates return only Saturday, only Sunday, or empty Friday slots', async () => {
        await availability.replaceWeekly(String(serviceA._id), { schedule: week({ SATURDAY: ['09:00', '11:00'], SUNDAY: ['10:00', '16:00'] }) }, actor());
        expect((await availability.listForMobile(String(serviceA._id), '2026-09-12')).map(row => row.time)).toEqual(['09:00', '11:00']);
        expect((await availability.listForMobile(String(serviceA._id), '2026-09-13')).map(row => row.time)).toEqual(['10:00', '16:00']);
        expect(await availability.listForMobile(String(serviceA._id), '2026-09-18')).toEqual([]);
    });

    test('mobile weekday query remains stable at Baghdad UTC day boundaries', async () => {
        await availability.replaceWeekly(String(serviceA._id), { schedule: week({ SATURDAY: ['00:30'], SUNDAY: ['00:45'] }) }, actor());
        expect((await availability.listForMobile(String(serviceA._id), '2026-09-12', new Date('2026-09-11T20:59:59.999Z'))).map(row => row.time)).toEqual(['00:30']);
        expect((await availability.listForMobile(String(serviceA._id), '2026-09-13', new Date('2026-09-12T21:00:00.000Z'))).map(row => row.time)).toEqual(['00:45']);
    });

    test('request creation derives preferred_time and rejects a slot from another weekday', async () => {
        const date = '2099-09-12';
        const correctDay = homeCareWeekdayForDate(date);
        const wrongDay = HOME_CARE_WEEKDAYS.find(day => day !== correctDay)!;
        await availability.replaceWeekly(String(serviceA._id), { schedule: week({ [correctDay]: ['11:00'], [wrongDay]: ['12:00'] }) }, actor());
        const correct = await HomeCareAvailabilitySlot.findOne({ service_id: serviceA._id, day_of_week: correctDay, time: '11:00' });
        const wrong = await HomeCareAvailabilitySlot.findOne({ service_id: serviceA._id, day_of_week: wrongDay, time: '12:00' });
        const request = await requests.createForPatient(patient._id, requestInput(correct!._id, date), patientActor());
        expect(request.preferred_time).toBe('11:00');
        expect(String(request.availability_slot_id)).toBe(String(correct!._id));
        expect(await rejected(requests.createForPatient(patient._id, requestInput(wrong!._id, date), patientActor())))
            .toMatchObject({ code: 'HOME_CARE_SLOT_NOT_AVAILABLE_FOR_DATE' });
    });

    test('transaction rechecks weekday and rejects a stale slot after weekly replacement', async () => {
        const date = '2099-10-10';
        const day = homeCareWeekdayForDate(date);
        await availability.replaceWeekly(String(serviceA._id), { schedule: week({ [day]: ['11:00'] }) }, actor());
        const selected = await HomeCareAvailabilitySlot.findOne({ service_id: serviceA._id, day_of_week: day, time: '11:00' });
        await availability.replaceWeekly(String(serviceA._id), { schedule: week({ [day]: ['12:00'] }) }, actor());
        expect(await rejected(requests.createForPatient(patient._id, requestInput(selected!._id, date), patientActor())))
            .toMatchObject({ code: 'HOME_CARE_SLOT_NOT_AVAILABLE_FOR_DATE' });
    });

    test('transaction independently rejects wrong weekday when preflight is bypassed', async () => {
        const saturdayDate = '2099-09-12';
        const saturday = homeCareWeekdayForDate(saturdayDate);
        const sundayDate = (() => {
            const date = new Date(`${saturdayDate}T00:00:00.000Z`);
            date.setUTCDate(date.getUTCDate() + 1);
            return date.toISOString().slice(0, 10);
        })();
        await availability.replaceWeekly(String(serviceA._id), { schedule: week({ [saturday]: ['11:00'] }) }, actor());
        const selected = await HomeCareAvailabilitySlot.findOne({ service_id: serviceA._id, day_of_week: saturday, time: '11:00' });
        spyOn(homeCareAvailabilityService, 'requireAvailableForRequest').mockResolvedValue(selected!);
        expect(await rejected(requests.createForPatient(patient._id, requestInput(selected!._id, sundayDate), patientActor())))
            .toMatchObject({ code: 'HOME_CARE_SLOT_NOT_AVAILABLE_FOR_DATE' });
        expect(await HomeCareRequest.countDocuments()).toBe(0);
    });

    test('concurrent weekly replacement versus request is serialized safely and preserves snapshots', async () => {
        const date = '2099-11-14';
        const day = homeCareWeekdayForDate(date);
        let successes = 0;
        for (let iteration = 0; iteration < 20; iteration += 1) {
            await availability.replaceWeekly(String(serviceA._id), { schedule: week({ [day]: ['11:00'] }) }, actor());
            const selected = await HomeCareAvailabilitySlot.findOne({ service_id: serviceA._id, day_of_week: day, time: '11:00', status: 'active' });
            const [replacement, booking] = await Promise.allSettled([
                availability.replaceWeekly(String(serviceA._id), { schedule: week({ [day]: ['12:00'] }) }, actor()),
                requests.createForPatient(new mongoose.Types.ObjectId(), requestInput(selected!._id, date), patientActor()),
            ]);
            expect(replacement.status).toBe('fulfilled');
            if (booking.status === 'fulfilled') {
                successes += 1;
                expect(booking.value.preferred_time).toBe('11:00');
            } else {
                expect(booking.reason).toMatchObject({ code: 'HOME_CARE_SLOT_NOT_AVAILABLE_FOR_DATE' });
            }
        }
        expect(await HomeCareRequest.countDocuments()).toBe(successes);
        expect(await HomeCareRequestHistory.countDocuments({ event_type: 'REQUEST_CREATED' })).toBe(successes);
    }, 120_000);

    test('historical request snapshots and legacy request readability survive schedule edits', async () => {
        const date = '2099-12-01';
        const day = homeCareWeekdayForDate(date);
        await availability.replaceWeekly(String(serviceA._id), { schedule: week({ [day]: ['08:30'] }) }, actor());
        const selected = await HomeCareAvailabilitySlot.findOne({ service_id: serviceA._id, day_of_week: day, time: '08:30' });
        const created = await requests.createForPatient(patient._id, requestInput(selected!._id, date), patientActor());
        const originalSnapshot = {
            requested_date: created.requested_date.toISOString(), preferred_time: created.preferred_time,
            availability_slot_id: String(created.availability_slot_id), service_name: created.service_name,
            service_price: created.service_price, service_duration_min: created.service_duration_min,
            service_duration_max: created.service_duration_max,
        };
        await availability.replaceWeekly(String(serviceA._id), { schedule: week({ [day]: ['09:30'] }) }, actor());
        const historical = await HomeCareRequest.findById(created._id).lean();
        expect({
            requested_date: historical?.requested_date.toISOString(), preferred_time: historical?.preferred_time,
            availability_slot_id: String(historical?.availability_slot_id), service_name: historical?.service_name,
            service_price: historical?.service_price, service_duration_min: historical?.service_duration_min,
            service_duration_max: historical?.service_duration_max,
        }).toEqual(originalSnapshot);
        const legacy = await HomeCareRequest.create({
            request_number: 'HC-LEGACY-000001', patient_id: patient._id, category_id: category._id, service_id: serviceA._id,
            service_name: 'Legacy', service_price: 1, requested_date: new Date('2099-12-02T00:00:00Z'), preferred_time: '07:00',
            address: { address_text: 'Baghdad legacy address', lat: 33.3, lng: 44.3 }, status: 'pending',
            dispatch: { status: 'OPEN', mode: 'OPEN_POOL', nurse_id: null, version: 0 },
        });
        expect(formatHomeCareRequestForMobile(legacy).preferred_time).toBe('07:00');
        expect(formatHomeCareRequestForMobile(legacy).availability_slot_id).toBeNull();
    });

    test('migration detects legacy and invalid weekdays without rewriting records or references', async () => {
        const legacyId = new mongoose.Types.ObjectId();
        const invalidId = new mongoose.Types.ObjectId();
        await HomeCareAvailabilitySlot.collection.insertOne({ _id: legacyId, service_id: serviceA._id, time: '06:00', status: 'active', display_order: 10 });
        await HomeCareAvailabilitySlot.collection.insertOne({ _id: invalidId, service_id: serviceA._id, day_of_week: 'FUNDAY', time: '06:30', status: 'active', display_order: 20 });
        const historical = await HomeCareRequest.create({
            request_number: 'HC-LEGACY-SLOT-000001', patient_id: patient._id, category_id: category._id, service_id: serviceA._id,
            availability_slot_id: legacyId, service_name: 'Legacy slot request', service_price: 1,
            requested_date: new Date('2099-12-03T00:00:00Z'), preferred_time: '06:00',
            address: { address_text: 'Baghdad legacy address', lat: 33.3, lng: 44.3 }, status: 'pending',
            dispatch: { status: 'OPEN', mode: 'OPEN_POOL', nurse_id: null, version: 0 },
        });
        const result = await migrateHomeCareWeeklyAvailability();
        expect(result.unresolved_legacy_slots).toBe(2);
        expect((await HomeCareAvailabilitySlot.collection.findOne({ _id: legacyId }))?.day_of_week).toBeUndefined();
        expect((await HomeCareAvailabilitySlot.collection.findOne({ _id: invalidId }))?.day_of_week).toBe('FUNDAY');
        expect(String((await HomeCareRequest.findById(historical._id))?.availability_slot_id)).toBe(String(legacyId));
        await availability.replaceWeekly(String(serviceA._id), { schedule: week({ SATURDAY: ['06:00'] }) }, actor());
        expect(await HomeCareAvailabilitySlot.countDocuments({ service_id: serviceA._id, time: '06:00' })).toBe(2);
        expect((await availability.listForDashboard(String(serviceA._id))).schedule[0]).toEqual({ day_of_week: 'SATURDAY', times: ['06:00'] });
    });

    test('actual weekly indexes support duplicate boundaries and weekday mobile scans', async () => {
        const indexes = await HomeCareAvailabilitySlot.collection.indexes();
        const unique = indexes.find(index => index.unique && JSON.stringify(index.key) === JSON.stringify({ service_id: 1, day_of_week: 1, time: 1 }));
        expect(unique).toBeDefined();
        expect(unique?.partialFilterExpression).toEqual({ day_of_week: { $type: 'string' } });
        expect(indexes.some(index => JSON.stringify(index.key) === JSON.stringify({ service_id: 1, day_of_week: 1, status: 1, display_order: 1 }))).toBe(true);
        await HomeCareAvailabilitySlot.collection.insertOne({ service_id: serviceA._id, time: '07:00', status: 'active' });
        await HomeCareAvailabilitySlot.collection.insertOne({ service_id: serviceA._id, time: '07:00', status: 'active' });
        await HomeCareAvailabilitySlot.collection.insertOne({ service_id: serviceA._id, day_of_week: 'MALFORMED', time: '07:30', status: 'active' });
        expect(await rejected(HomeCareAvailabilitySlot.collection.insertOne({ service_id: serviceA._id, day_of_week: 'MALFORMED', time: '07:30', status: 'active' }))).toMatchObject({ code: 11000 });
    });
});
