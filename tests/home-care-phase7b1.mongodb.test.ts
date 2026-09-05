import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import mongoose from 'mongoose';
import User from '../src/models/users.model';
import Patient from '../src/models/patients.model';
import Nurse from '../src/models/nurse.model';
import HomeCareCategory from '../src/models/home-care-category.model';
import HomeCareService from '../src/models/home-care-service.model';
import HomeCareRequest from '../src/models/home-care-request.model';
import HomeCareRequestHistory from '../src/models/home-care-request-history.model';
import HomeCareRequestCounter from '../src/models/home-care-request-counter.model';
import ActivityLog from '../src/models/activity-log.model';
import { HomeCareDispatchService } from '../src/services/home-care-dispatch.service';
import historyService from '../src/services/home-care-request-history.service';
import { IHomeCareDispatchModeEnum as Mode, IHomeCareDispatchStatusEnum as Dispatch, IHomeCareRequestStatusEnum as Status } from '../src/interfaces/home-care-request.interface';
import { HomeCareHistoryEventEnum as Event } from '../src/interfaces/home-care-request-history.interface';

const mongoUri = process.env.MONGODB_TEST_URI;
const describeWithMongo = mongoUri ? describe : describe.skip;
const service = new HomeCareDispatchService({ homeCare: async () => null });

describeWithMongo('Home Care Phase 7B1 admin dispatch transactions against MongoDB 8 replica set', () => {
    const databaseName = `cannula_home_care_phase7b1_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    let patient: any, admin: any, nurseA: any, nurseB: any, category: any, care: any;
    const actor = () => ({ user_id: String(admin._id), user_type: 'admin' as const, endpoint: '/admin/home-care' });
    const nurseActor = (nurse: any) => ({ user_id: String(nurse.user_id), user_type: 'nurse' as const, nurse_id: String(nurse._id), endpoint: '/nurse/home-care' });
    const rejected = async (operation: Promise<unknown>) => { try { await operation; } catch (error) { return error as any; } throw new Error('Expected operation to reject'); };
    const count = (id: any, event: string) => HomeCareRequestHistory.countDocuments({ request_id: id, event_type: event });

    beforeAll(async () => {
        await mongoose.connect(mongoUri!, { dbName: databaseName });
        const session = await mongoose.startSession();
        try { await session.withTransaction(async () => undefined); } finally { await session.endSession(); }
        await Promise.all([User.syncIndexes(), Patient.syncIndexes(), Nurse.syncIndexes(), HomeCareCategory.syncIndexes(), HomeCareService.syncIndexes(), HomeCareRequest.syncIndexes(), HomeCareRequestHistory.syncIndexes()]);
    });
    afterAll(async () => { if (mongoose.connection.db) await mongoose.connection.db.dropDatabase(); await mongoose.disconnect(); });
    afterEach(() => mock.restore());
    beforeEach(async () => {
        await Promise.all([User.deleteMany({}), Patient.deleteMany({}), Nurse.deleteMany({}), HomeCareCategory.deleteMany({}), HomeCareService.deleteMany({}), HomeCareRequest.deleteMany({}), HomeCareRequestHistory.deleteMany({}), HomeCareRequestCounter.deleteMany({}), ActivityLog.deleteMany({})]);
        const users = await User.create([
            { full_name: 'Patient', phone: `077${Date.now()}1`, password_hash: 'hash', role: 'patient', status: 'active', is_phone_verified: true },
            { full_name: 'Admin', phone: `077${Date.now()}2`, password_hash: 'hash', role: 'admin', status: 'active', is_phone_verified: true },
            { full_name: 'Nurse A', phone: `077${Date.now()}3`, password_hash: 'hash', role: 'nurse', status: 'active', is_phone_verified: true },
            { full_name: 'Nurse B', phone: `077${Date.now()}4`, password_hash: 'hash', role: 'nurse', status: 'active', is_phone_verified: true },
        ]);
        patient = await Patient.create({ user_id: users[0]._id, full_name: 'Patient', phone: users[0].phone, status: 'active' }); admin = users[1];
        category = await HomeCareCategory.create({ name: `Category ${Date.now()}`, normalized_name: `category-${Date.now()}`, status: 'active' });
        care = await HomeCareService.create({ category_id: category._id, name: `Care ${Date.now()}`, price: 10000, status: 'active' });
        nurseA = await Nurse.create({ user_id: users[2]._id, full_name: 'Nurse A', status: 'active', qualified_service_ids: [care._id] });
        nurseB = await Nurse.create({ user_id: users[3]._id, full_name: 'Nurse B', status: 'active', qualified_service_ids: [care._id] });
    });
    async function request(status: string = Status.PENDING, nurse: any = null, version = 0, mode: string = Mode.OPEN_POOL) {
        return HomeCareRequest.create({ request_number: `HC-B1-${new mongoose.Types.ObjectId().toString().slice(-8)}`, patient_id: patient._id, category_id: category._id, service_id: care._id, service_name: care.name, service_price: care.price, requested_date: new Date('2099-01-02'), preferred_time: '12:00', address: { address_text: 'Baghdad', lat: 33.3, lng: 44.3 }, status, dispatch: { status: nurse ? Dispatch.CLAIMED : Dispatch.OPEN, mode, nurse_id: nurse?._id ?? null, assigned_at: nurse ? new Date() : null, assigned_by_user_id: null, version }, cancelled_at: null, cancelled_by: null, cancellation_reason: null });
    }
    function fail(event: string) { return spyOn(historyService, 'append').mockImplementation(async (payload: any, options?: any) => { if (options?.critical && payload.event_type === event) throw new Error(`FORCED_${event}`); }); }
    async function final(id: any) { return HomeCareRequest.findById(id).lean(); }

    test('rollback: admin direct assign preserves open pending request when critical history fails', async () => {
        const item = await request(Status.PENDING); fail(Event.ASSIGNED_BY_ADMIN);
        await rejected(service.assign(String(item._id), String(nurseA._id), actor())); const result = await final(item._id);
        expect(result?.status).toBe(Status.PENDING); expect(result?.dispatch.status).toBe(Dispatch.OPEN); expect(result?.dispatch.nurse_id).toBeNull(); expect(result?.dispatch.version).toBe(0); expect(await count(item._id, Event.ASSIGNED_BY_ADMIN)).toBe(0);
    });
    test('rollback: admin reassign preserves owned operational request when critical history fails', async () => {
        const item = await request(Status.ON_THE_WAY, nurseA, 4); fail(Event.REASSIGNED_BY_ADMIN);
        await rejected(service.reassign(String(item._id), String(nurseB._id), 'operational reason', actor())); const result = await final(item._id);
        expect(result?.status).toBe(Status.ON_THE_WAY); expect(result?.dispatch.status).toBe(Dispatch.CLAIMED); expect(String(result?.dispatch.nurse_id)).toBe(String(nurseA._id)); expect(result?.dispatch.version).toBe(4); expect(await count(item._id, Event.REASSIGNED_BY_ADMIN)).toBe(0);
    });
    test('rollback: admin unassign preserves owned operational request when critical history fails', async () => {
        const item = await request(Status.IN_PROGRESS, nurseA, 5); fail(Event.UNASSIGNED_BY_ADMIN);
        await rejected(service.unassign(String(item._id), 'operational reason', actor())); const result = await final(item._id);
        expect(result?.status).toBe(Status.IN_PROGRESS); expect(result?.dispatch.status).toBe(Dispatch.CLAIMED); expect(String(result?.dispatch.nurse_id)).toBe(String(nurseA._id)); expect(result?.dispatch.version).toBe(5); expect(await count(item._id, Event.UNASSIGNED_BY_ADMIN)).toBe(0);
    });
    test('rollback: admin reopen preserves cancelled metadata and dispatch when critical history fails', async () => {
        const item = await request(Status.CANCELLED, nurseA, 6, Mode.ADMIN_DIRECT); item.dispatch.status = Dispatch.CLOSED; item.cancelled_at = new Date('2099-01-01'); item.cancelled_by = { id: admin._id, type: 'ADMIN' } as any; item.cancellation_reason = 'cancelled'; await item.save(); fail(Event.REQUEST_REOPENED);
        await rejected(service.reopen(String(item._id), 'reopen reason', actor())); const result = await final(item._id);
        expect(result?.status).toBe(Status.CANCELLED); expect(result?.dispatch.status).toBe(Dispatch.CLOSED); expect(result?.dispatch.mode).toBe(Mode.ADMIN_DIRECT); expect(String(result?.dispatch.nurse_id)).toBe(String(nurseA._id)); expect(result?.dispatch.version).toBe(6); expect(result?.cancelled_at).toBeTruthy(); expect(result?.cancellation_reason).toBe('cancelled'); expect(await count(item._id, Event.REQUEST_REOPENED)).toBe(0);
    });
    test('race: admin direct assign versus nurse claim has exactly one assignment and version increment', async () => {
        const item = await request(); const outcomes = await Promise.allSettled([service.assign(String(item._id), String(nurseA._id), actor()), service.claim(String(nurseB.user_id), String(item._id), nurseActor(nurseB))]); const result = await final(item._id);
        expect(outcomes.filter(x => x.status === 'fulfilled')).toHaveLength(1); expect(outcomes.filter(x => x.status === 'rejected')).toHaveLength(1); expect(result?.status).toBe(Status.ASSIGNED); expect(result?.dispatch.status).toBe(Dispatch.CLAIMED); expect([Mode.ADMIN_DIRECT, Mode.OPEN_POOL]).toContain(result?.dispatch.mode as any); expect(result?.dispatch.version).toBe(1); expect(await HomeCareRequestHistory.countDocuments({ request_id: item._id, event_type: { $in: [Event.ASSIGNED_BY_ADMIN, Event.CLAIMED_BY_NURSE] } })).toBe(1);
    });
    test('race: two admin direct assigns yield one success, one conflict, one history and version increment', async () => {
        const item = await request(); const outcomes = await Promise.allSettled([service.assign(String(item._id), String(nurseA._id), actor()), service.assign(String(item._id), String(nurseB._id), actor())]); const result = await final(item._id);
        expect(outcomes.filter(x => x.status === 'fulfilled')).toHaveLength(1); expect(outcomes.filter(x => x.status === 'rejected')).toHaveLength(1); expect((outcomes.find(x => x.status === 'rejected') as any).reason).toMatchObject({ status: 409 }); expect([String(nurseA._id), String(nurseB._id)]).toContain(String(result?.dispatch.nurse_id)); expect(result?.dispatch.version).toBe(1); expect(await count(item._id, Event.ASSIGNED_BY_ADMIN)).toBe(1);
    });
    test('race: stale admin reassign conflicts without stale history or version increment', async () => {
        const item = await request(Status.ASSIGNED, nurseA, 3); const outcomes = await Promise.allSettled([service.reassign(String(item._id), String(nurseB._id), 'reason', actor()), service.reassign(String(item._id), String(nurseB._id), 'reason', actor())]); const result = await final(item._id);
        expect(outcomes.filter(x => x.status === 'fulfilled')).toHaveLength(1); expect((outcomes.find(x => x.status === 'rejected') as any).reason).toMatchObject({ status: 409 }); expect(result?.status).toBe(Status.ASSIGNED); expect(String(result?.dispatch.nurse_id)).toBe(String(nurseB._id)); expect(result?.dispatch.version).toBe(4); expect(await count(item._id, Event.REASSIGNED_BY_ADMIN)).toBe(1);
    });
    test('race: reassign versus current nurse transition has only serializable ownership/history outcomes', async () => {
        const item = await request(Status.ASSIGNED, nurseA, 1); const outcomes = await Promise.allSettled([service.reassign(String(item._id), String(nurseB._id), 'reason', actor()), service.transition(String(nurseA.user_id), String(item._id), Status.ASSIGNED, Status.ON_THE_WAY, nurseActor(nurseA))]); const result = await final(item._id); const events = await HomeCareRequestHistory.find({ request_id: item._id }).sort({ createdAt: 1, _id: 1 });
        expect(outcomes.filter(x => x.status === 'fulfilled').length).toBeGreaterThanOrEqual(1); expect(result?.dispatch.status).toBe(Dispatch.CLAIMED); expect(result?.dispatch.nurse_id).toBeTruthy(); expect(result?.dispatch.version).toBe(1 + events.length); if (String(result?.dispatch.nurse_id) === String(nurseB._id)) { expect(result?.status).toBe(Status.ASSIGNED); expect(events.map(x => x.event_type)).toEqual(events.length === 2 ? [Event.STATUS_CHANGED, Event.REASSIGNED_BY_ADMIN] : [Event.REASSIGNED_BY_ADMIN]); } else { expect(String(result?.dispatch.nurse_id)).toBe(String(nurseA._id)); expect(result?.status).toBe(Status.ON_THE_WAY); expect(events.map(x => x.event_type)).toEqual([Event.STATUS_CHANGED]); }
    });
    test('race: unassign versus current nurse transition never leaves hybrid dispatch state', async () => {
        const item = await request(Status.ASSIGNED, nurseA, 1); const outcomes = await Promise.allSettled([service.unassign(String(item._id), 'reason', actor()), service.transition(String(nurseA.user_id), String(item._id), Status.ASSIGNED, Status.ON_THE_WAY, nurseActor(nurseA))]); const result = await final(item._id); const events = await HomeCareRequestHistory.find({ request_id: item._id }).sort({ createdAt: 1, _id: 1 });
        expect(outcomes.filter(x => x.status === 'fulfilled').length).toBeGreaterThanOrEqual(1); expect(result?.dispatch.version).toBe(1 + events.length); if (result?.dispatch.status === Dispatch.OPEN) { expect(result.status).toBe(Status.CONFIRMED); expect(result.dispatch.mode).toBe(Mode.OPEN_POOL); expect(result.dispatch.nurse_id).toBeNull(); expect(events.map(x => x.event_type)).toEqual(events.length === 2 ? [Event.STATUS_CHANGED, Event.UNASSIGNED_BY_ADMIN] : [Event.UNASSIGNED_BY_ADMIN]); } else { expect(result?.dispatch.status).toBe(Dispatch.CLAIMED); expect(result?.dispatch.nurse_id).toBeTruthy(); expect(result?.status).toBe(Status.ON_THE_WAY); expect(events.map(x => x.event_type)).toEqual([Event.STATUS_CHANGED]); }
    });
    test('race: two admin reopen attempts yield one reopen, one conflict, one history and version increment', async () => {
        const item = await request(Status.REJECTED, null, 7); item.dispatch.status = Dispatch.CLOSED; await item.save(); const outcomes = await Promise.allSettled([service.reopen(String(item._id), 'reason', actor()), service.reopen(String(item._id), 'reason', actor())]); const result = await final(item._id);
        expect(outcomes.filter(x => x.status === 'fulfilled')).toHaveLength(1); expect((outcomes.find(x => x.status === 'rejected') as any).reason).toMatchObject({ status: 409 }); expect(result?.status).toBe(Status.CONFIRMED); expect(result?.dispatch.status).toBe(Dispatch.OPEN); expect(result?.dispatch.mode).toBe(Mode.OPEN_POOL); expect(result?.dispatch.nurse_id).toBeNull(); expect(result?.dispatch.version).toBe(8); expect(await count(item._id, Event.REQUEST_REOPENED)).toBe(1);
    });
});
