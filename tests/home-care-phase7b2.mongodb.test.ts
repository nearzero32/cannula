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
import { HomeCareRequestService } from '../src/services/home-care-request.service';
import historyService from '../src/services/home-care-request-history.service';
import { IHomeCareDispatchModeEnum as Mode, IHomeCareDispatchStatusEnum as Dispatch, IHomeCareRequestStatusEnum as Status } from '../src/interfaces/home-care-request.interface';
import { HomeCareHistoryEventEnum as Event } from '../src/interfaces/home-care-request-history.interface';

const mongoUri = process.env.MONGODB_TEST_URI;
const describeWithMongo = mongoUri ? describe : describe.skip;
const dispatchService = new HomeCareDispatchService();
const requestService = new HomeCareRequestService();

describeWithMongo('Home Care Phase 7B2 Nurse operational transactions against MongoDB 8 replica set', () => {
    const databaseName = `cannula_home_care_phase7b2_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    let patient: any, admin: any, nurseA: any, nurseB: any, category: any, care: any;
    const adminActor = () => ({ user_id: String(admin._id), user_type: 'admin' as const, endpoint: '/admin/home-care' });
    const nurseActor = (nurse: any) => ({ user_id: String(nurse.user_id), user_type: 'nurse' as const, nurse_id: String(nurse._id), endpoint: '/nurse/home-care' });
    const rejected = async (operation: Promise<unknown>) => { try { await operation; } catch (error) { return error as any; } throw new Error('Expected operation to reject'); };
    const eventCount = (id: any, event: string) => HomeCareRequestHistory.countDocuments({ request_id: id, event_type: event });

    beforeAll(async () => {
        await mongoose.connect(mongoUri!, { dbName: databaseName });
        const session = await mongoose.startSession(); try { await session.withTransaction(async () => undefined); } finally { await session.endSession(); }
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
        category = await HomeCareCategory.create({ name: `Category ${Date.now()}`, normalized_name: `category-${Date.now()}`, status: 'active' }); care = await HomeCareService.create({ category_id: category._id, name: `Care ${Date.now()}`, price: 10000, status: 'active' });
        nurseA = await Nurse.create({ user_id: users[2]._id, full_name: 'Nurse A', status: 'active', qualified_service_ids: [care._id] }); nurseB = await Nurse.create({ user_id: users[3]._id, full_name: 'Nurse B', status: 'active', qualified_service_ids: [care._id] });
    });
    async function request(status: string, version = 0, nurse: any = nurseA, mode: string = Mode.ADMIN_DIRECT) {
        return HomeCareRequest.create({ request_number: `HC-B2-${new mongoose.Types.ObjectId().toString().slice(-8)}`, patient_id: patient._id, category_id: category._id, service_id: care._id, service_name: care.name, service_price: care.price, requested_date: new Date('2099-01-02'), preferred_time: '12:00', address: { address_text: 'Baghdad', lat: 33.3, lng: 44.3 }, status, dispatch: { status: Dispatch.CLAIMED, mode, nurse_id: nurse._id, assigned_at: new Date(), assigned_by_user_id: admin._id, version }, cancelled_at: null, cancelled_by: null, cancellation_reason: null });
    }
    const final = (id: any) => HomeCareRequest.findById(id).lean();
    function fail(event: string) { return spyOn(historyService, 'append').mockImplementation(async (payload: any, options?: any) => { if (options?.critical && payload.event_type === event) throw new Error(`FORCED_${event}`); }); }
    async function transition(item: any, from: any, to: any, nurse = nurseA) { return dispatchService.transition(String(nurse.user_id), String(item._id), from, to, nurseActor(nurse)); }

    for (const [from, to, event] of [[Status.ASSIGNED, Status.ON_THE_WAY, Event.STATUS_CHANGED], [Status.ON_THE_WAY, Status.ARRIVED, Event.STATUS_CHANGED], [Status.ARRIVED, Status.IN_PROGRESS, Event.STATUS_CHANGED], [Status.IN_PROGRESS, Status.COMPLETED, Event.COMPLETED]] as const) {
        test(`rollback: ${from} to ${to} preserves request when critical History fails`, async () => {
            const item = await request(from, 4); fail(event); await rejected(transition(item, from, to)); const result = await final(item._id);
            expect(result?.status).toBe(from); expect(result?.dispatch.status).toBe(Dispatch.CLAIMED); expect(String(result?.dispatch.nurse_id)).toBe(String(nurseA._id)); expect(result?.dispatch.version).toBe(4); expect(await eventCount(item._id, event)).toBe(0);
        });
    }

    test('race: duplicate Nurse transition has one winner, one event, and one version increment', async () => {
        const item = await request(Status.ASSIGNED, 2); const outcomes = await Promise.allSettled([transition(item, Status.ASSIGNED, Status.ON_THE_WAY), transition(item, Status.ASSIGNED, Status.ON_THE_WAY)]); const result = await final(item._id);
        expect(outcomes.filter(x => x.status === 'fulfilled')).toHaveLength(1); expect((outcomes.find(x => x.status === 'rejected') as any).reason).toMatchObject({ status: 409 }); expect(result?.status).toBe(Status.ON_THE_WAY); expect(String(result?.dispatch.nurse_id)).toBe(String(nurseA._id)); expect(result?.dispatch.version).toBe(3); expect(await eventCount(item._id, Event.STATUS_CHANGED)).toBe(1);
    });
    test('race: wrong Nurse never gains authority over current owner transition', async () => {
        const item = await request(Status.ASSIGNED, 1); const outcomes = await Promise.allSettled([transition(item, Status.ASSIGNED, Status.ON_THE_WAY, nurseA), transition(item, Status.ASSIGNED, Status.ON_THE_WAY, nurseB)]); const result = await final(item._id); const event = await HomeCareRequestHistory.findOne({ request_id: item._id, event_type: Event.STATUS_CHANGED });
        expect(outcomes.filter(x => x.status === 'fulfilled')).toHaveLength(1); expect(String(result?.dispatch.nurse_id)).toBe(String(nurseA._id)); expect(result?.status).toBe(Status.ON_THE_WAY); expect(result?.dispatch.version).toBe(2); expect(await eventCount(item._id, Event.STATUS_CHANGED)).toBe(1); expect(String(event?.actor.nurse_id)).toBe(String(nurseA._id));
    });
    test('race: Nurse transition versus Admin reassign yields only serializable ownership/history', async () => {
        const item = await request(Status.ON_THE_WAY, 3); const outcomes = await Promise.allSettled([transition(item, Status.ON_THE_WAY, Status.ARRIVED), dispatchService.reassign(String(item._id), String(nurseB._id), 'reason', adminActor())]); const result = await final(item._id); const events = await HomeCareRequestHistory.find({ request_id: item._id }).sort({ createdAt: 1, _id: 1 });
        expect(outcomes.filter(x => x.status === 'fulfilled').length).toBeGreaterThanOrEqual(1); expect(result?.dispatch.version).toBe(3 + events.length); if (String(result?.dispatch.nurse_id) === String(nurseB._id)) { expect(result?.status).toBe(Status.ASSIGNED); expect(events.map(x => x.event_type)).toEqual(events.length === 2 ? [Event.STATUS_CHANGED, Event.REASSIGNED_BY_ADMIN] : [Event.REASSIGNED_BY_ADMIN]); } else { expect(String(result?.dispatch.nurse_id)).toBe(String(nurseA._id)); expect(result?.status).toBe(Status.ARRIVED); expect(events.map(x => x.event_type)).toEqual([Event.STATUS_CHANGED]); }
    });
    test('race: Nurse transition versus Admin unassign has no active unowned or pool/claimed hybrid', async () => {
        const item = await request(Status.ASSIGNED, 2); const outcomes = await Promise.allSettled([transition(item, Status.ASSIGNED, Status.ON_THE_WAY), dispatchService.unassign(String(item._id), 'reason', adminActor())]); const result = await final(item._id); const events = await HomeCareRequestHistory.find({ request_id: item._id }).sort({ createdAt: 1, _id: 1 });
        expect(outcomes.filter(x => x.status === 'fulfilled').length).toBeGreaterThanOrEqual(1); expect(result?.dispatch.version).toBe(2 + events.length); if (result?.dispatch.status === Dispatch.OPEN) { expect(result.status).toBe(Status.CONFIRMED); expect(result.dispatch.mode).toBe(Mode.OPEN_POOL); expect(result.dispatch.nurse_id).toBeNull(); expect(events.map(x => x.event_type)).toEqual(events.length === 2 ? [Event.STATUS_CHANGED, Event.UNASSIGNED_BY_ADMIN] : [Event.UNASSIGNED_BY_ADMIN]); } else { expect(result?.status).toBe(Status.ON_THE_WAY); expect(result?.dispatch.status).toBe(Dispatch.CLAIMED); expect(String(result?.dispatch.nurse_id)).toBe(String(nurseA._id)); expect(events.map(x => x.event_type)).toEqual([Event.STATUS_CHANGED]); }
    });
    test('race: complete versus Admin cancel has exactly one terminal winner', async () => {
        const item = await request(Status.IN_PROGRESS, 5); const outcomes = await Promise.allSettled([transition(item, Status.IN_PROGRESS, Status.COMPLETED), requestService.cancelForAdmin(String(item._id), 'reason', adminActor() as any)]); const result = await final(item._id); const terminalEvents = await HomeCareRequestHistory.countDocuments({ request_id: item._id, event_type: { $in: [Event.COMPLETED, Event.REQUEST_CANCELLED] } });
        expect(outcomes.filter(x => x.status === 'fulfilled')).toHaveLength(1); expect([Status.COMPLETED, Status.CANCELLED]).toContain(result?.status as any); expect(result?.dispatch.status).toBe(Dispatch.CLOSED); expect(result?.dispatch.version).toBe(6); expect(terminalEvents).toBe(1);
    });
    test('race: complete versus Admin reassign never moves completed request back to assigned', async () => {
        const item = await request(Status.IN_PROGRESS, 2); const outcomes = await Promise.allSettled([transition(item, Status.IN_PROGRESS, Status.COMPLETED), dispatchService.reassign(String(item._id), String(nurseB._id), 'reason', adminActor())]); const result = await final(item._id); const events = await HomeCareRequestHistory.find({ request_id: item._id });
        expect(outcomes.filter(x => x.status === 'fulfilled')).toHaveLength(1); expect(result?.dispatch.version).toBe(3); expect(events).toHaveLength(1); if (result?.status === Status.COMPLETED) { expect(result.dispatch.status).toBe(Dispatch.CLOSED); expect(String(result.dispatch.nurse_id)).toBe(String(nurseA._id)); expect(events[0].event_type).toBe(Event.COMPLETED); } else { expect(result?.status).toBe(Status.ASSIGNED); expect(String(result?.dispatch.nurse_id)).toBe(String(nurseB._id)); expect(events[0].event_type).toBe(Event.REASSIGNED_BY_ADMIN); }
    });
    test('full progression is transactional, exact, and terminal', async () => {
        const item = await request(Status.ASSIGNED, 10); const steps = [[Status.ASSIGNED, Status.ON_THE_WAY], [Status.ON_THE_WAY, Status.ARRIVED], [Status.ARRIVED, Status.IN_PROGRESS], [Status.IN_PROGRESS, Status.COMPLETED]] as const;
        for (let index = 0; index < steps.length; index += 1) { const [from, to] = steps[index]; await transition(item, from, to); const result = await final(item._id); expect(result?.status).toBe(to); expect(String(result?.dispatch.nurse_id)).toBe(String(nurseA._id)); expect(result?.dispatch.status).toBe(to === Status.COMPLETED ? Dispatch.CLOSED : Dispatch.CLAIMED); expect(result?.dispatch.version).toBe(11 + index); expect(await HomeCareRequestHistory.countDocuments({ request_id: item._id })).toBe(index + 1); }
        await expect(transition(item, Status.IN_PROGRESS, Status.COMPLETED)).rejects.toMatchObject({ status: 409 }); const result = await final(item._id); expect(result?.dispatch.version).toBe(14); expect(await HomeCareRequestHistory.countDocuments({ request_id: item._id })).toBe(4);
    });
});
