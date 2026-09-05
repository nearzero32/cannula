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
import { HomeCareRequestService } from '../src/services/home-care-request.service';
import { HomeCareDispatchService } from '../src/services/home-care-dispatch.service';
import historyService from '../src/services/home-care-request-history.service';
import { IHomeCareDispatchModeEnum as Mode, IHomeCareDispatchStatusEnum as Dispatch, IHomeCareRequestStatusEnum as Status } from '../src/interfaces/home-care-request.interface';
import { HomeCareHistoryEventEnum as Event } from '../src/interfaces/home-care-request-history.interface';

const mongoUri = process.env.MONGODB_TEST_URI;
const describeWithMongo = mongoUri ? describe : describe.skip;
const noNotifications = { homeCare: async () => null };
const patientService = new HomeCareRequestService(noNotifications);
const dispatchService = new HomeCareDispatchService(noNotifications);

describeWithMongo('Home Care Phase 7A transactions against MongoDB replica set', () => {
    const databaseName = `cannula_home_care_phase7a_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    let patient: any, admin: any, nurseA: any, nurseB: any, category: any, service: any;
    const patientActor = () => ({ user_id: String(patient.user_id), user_type: 'patient' as const, endpoint: '/mobile/test', source: 'mobile' as const });
    const adminActor = () => ({ user_id: String(admin._id), user_type: 'admin' as const, endpoint: '/admin/test', source: 'dashboard' as const });
    const nurseActor = (nurse: any) => ({ user_id: String(nurse.user_id), user_type: 'nurse' as const, nurse_id: String(nurse._id), endpoint: '/nurse/test' });
    const rejected = async (operation: Promise<unknown>) => { try { await operation; } catch (error) { return error as any; } throw new Error('Expected operation to reject'); };

    beforeAll(async () => {
        await mongoose.connect(mongoUri!, { dbName: databaseName });
        const session = await mongoose.startSession();
        try { await session.withTransaction(async () => undefined); } finally { await session.endSession(); }
        await Promise.all([User.syncIndexes(), Patient.syncIndexes(), Nurse.syncIndexes(), HomeCareCategory.syncIndexes(), HomeCareService.syncIndexes(), HomeCareRequest.syncIndexes(), HomeCareRequestHistory.syncIndexes()]);
    });
    afterAll(async () => { if (mongoose.connection.db) await mongoose.connection.db.dropDatabase(); await mongoose.disconnect(); });
    afterEach(() => { mock.restore(); });
    beforeEach(async () => {
        await Promise.all([User.deleteMany({}), Patient.deleteMany({}), Nurse.deleteMany({}), HomeCareCategory.deleteMany({}), HomeCareService.deleteMany({}), HomeCareRequest.deleteMany({}), HomeCareRequestHistory.deleteMany({}), HomeCareRequestCounter.deleteMany({}), ActivityLog.deleteMany({})]);
        const users = await User.create([
            { full_name: 'Patient Test', phone: `077${Date.now()}1`, password_hash: 'hash', role: 'patient', status: 'active', is_phone_verified: true },
            { full_name: 'Admin Test', phone: `077${Date.now()}2`, password_hash: 'hash', role: 'admin', status: 'active', is_phone_verified: true },
            { full_name: 'Nurse A', phone: `077${Date.now()}3`, password_hash: 'hash', role: 'nurse', status: 'active', is_phone_verified: true },
            { full_name: 'Nurse B', phone: `077${Date.now()}4`, password_hash: 'hash', role: 'nurse', status: 'active', is_phone_verified: true },
        ]);
        patient = await Patient.create({ user_id: users[0]._id, full_name: 'Patient Test', phone: users[0].phone, status: 'active' }); admin = users[1];
        category = await HomeCareCategory.create({ name: `Category ${Date.now()}`, normalized_name: `category-${Date.now()}`, status: 'active' });
        service = await HomeCareService.create({ category_id: category._id, name: `Service ${Date.now()}`, price: 10000, status: 'active' });
        nurseA = await Nurse.create({ user_id: users[2]._id, full_name: 'Nurse A', status: 'active', qualified_service_ids: [service._id] });
        nurseB = await Nurse.create({ user_id: users[3]._id, full_name: 'Nurse B', status: 'active', qualified_service_ids: [service._id] });
    });
    async function request(status: string = Status.PENDING, nurse: any = null, version = 0) {
        return HomeCareRequest.create({ request_number: `HC-T-${new mongoose.Types.ObjectId().toString().slice(-8)}`, patient_id: patient._id, category_id: category._id, service_id: service._id, service_name: service.name, service_price: service.price, requested_date: new Date('2099-01-02T00:00:00.000Z'), preferred_time: '12:00', address: { address_text: 'Baghdad test address', lat: 33.3, lng: 44.3 }, status, dispatch: { status: nurse ? Dispatch.CLAIMED : Dispatch.OPEN, mode: Mode.OPEN_POOL, nurse_id: nurse?._id ?? null, assigned_at: nurse ? new Date() : null, assigned_by_user_id: null, version }, cancelled_at: null, cancelled_by: null, cancellation_reason: null });
    }
    function failCriticalHistory() { return spyOn(historyService, 'append').mockImplementation(async (_payload: any, options?: any) => { if (options?.critical) throw new Error('FORCED_HISTORY_FAILURE'); }); }
    async function assertOpen(item: any, event: string) { const final = await HomeCareRequest.findById(item._id); expect(final?.status).toBe(Status.PENDING); expect(final?.dispatch.status).toBe(Dispatch.OPEN); expect(final?.dispatch.nurse_id).toBeNull(); expect(final?.dispatch.version).toBe(item.dispatch.version); expect(await HomeCareRequestHistory.countDocuments({ request_id: item._id, event_type: event })).toBe(0); }

    test('patient create rolls back when REQUEST_CREATED history fails', async () => { failCriticalHistory(); await rejected(patientService.createForPatient(patient._id, { service_id: String(service._id), requested_date: '2099-01-02', preferred_time: '12:00', address: { address_text: 'Baghdad test address', lat: 33.3, lng: 44.3 } }, patientActor())); expect(await HomeCareRequest.countDocuments()).toBe(0); expect(await HomeCareRequestHistory.countDocuments({ event_type: Event.REQUEST_CREATED })).toBe(0); });
    test('patient cancel rolls back when history fails', async () => { const item = await request(); failCriticalHistory(); await rejected(patientService.cancelForPatient(patient._id, String(item._id), 'reason', patientActor())); await assertOpen(item, Event.REQUEST_CANCELLED); const final = await HomeCareRequest.findById(item._id); expect(final?.cancelled_at).toBeNull(); });
    test('nurse claim rolls back when history fails', async () => { const item = await request(); failCriticalHistory(); await rejected(dispatchService.claim(String(nurseA.user_id), String(item._id), nurseActor(nurseA))); await assertOpen(item, Event.CLAIMED_BY_NURSE); });
    test('admin confirm rolls back when history fails', async () => { const item = await request(); failCriticalHistory(); await rejected(patientService.updateStatus(String(item._id), Status.CONFIRMED, adminActor())); await assertOpen(item, Event.STATUS_CHANGED); });
    test('admin reject rolls back when history fails', async () => { const item = await request(); failCriticalHistory(); await rejected(patientService.rejectForAdmin(String(item._id), 'reason', adminActor())); await assertOpen(item, Event.REQUEST_REJECTED); });
    test('admin cancel rolls back when history fails', async () => { const item = await request(Status.IN_PROGRESS, nurseA, 4); failCriticalHistory(); await rejected(patientService.cancelForAdmin(String(item._id), 'reason', adminActor())); const final = await HomeCareRequest.findById(item._id); expect(final?.status).toBe(Status.IN_PROGRESS); expect(final?.dispatch.status).toBe(Dispatch.CLAIMED); expect(String(final?.dispatch.nurse_id)).toBe(String(nurseA._id)); expect(final?.dispatch.version).toBe(4); expect(final?.cancelled_at).toBeNull(); expect(await HomeCareRequestHistory.countDocuments({ request_id: item._id, event_type: Event.REQUEST_CANCELLED })).toBe(0); });
    test('two nurses claim once with one history event', async () => { const item = await request(); const results = await Promise.allSettled([dispatchService.claim(String(nurseA.user_id), String(item._id), nurseActor(nurseA)), dispatchService.claim(String(nurseB.user_id), String(item._id), nurseActor(nurseB))]); expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1); expect(results.filter(x => x.status === 'rejected')).toHaveLength(1); expect((results.find(x => x.status === 'rejected') as any).reason).toMatchObject({ status: 409 }); const final = await HomeCareRequest.findById(item._id); expect(final?.status).toBe(Status.ASSIGNED); expect(final?.dispatch.status).toBe(Dispatch.CLAIMED); expect(final?.dispatch.version).toBe(1); const events = await HomeCareRequestHistory.find({ request_id: item._id, event_type: Event.CLAIMED_BY_NURSE }); expect(events).toHaveLength(1); expect(String(events[0].to_nurse_id)).toBe(String(final?.dispatch.nurse_id)); });
    test('patient cancel versus nurse claim has one winner and corresponding history', async () => { const item = await request(); const results = await Promise.allSettled([patientService.cancelForPatient(patient._id, String(item._id), 'reason', patientActor()), dispatchService.claim(String(nurseA.user_id), String(item._id), nurseActor(nurseA))]); expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1); expect((results.find(x => x.status === 'rejected') as any).reason).toMatchObject({ status: 409 }); const final = await HomeCareRequest.findById(item._id); if (final?.status === Status.CANCELLED) { expect(final.dispatch.status).toBe(Dispatch.CLOSED); expect(final.dispatch.nurse_id).toBeNull(); expect(await HomeCareRequestHistory.countDocuments({ request_id: item._id, event_type: Event.REQUEST_CANCELLED })).toBe(1); expect(await HomeCareRequestHistory.countDocuments({ request_id: item._id, event_type: Event.CLAIMED_BY_NURSE })).toBe(0); } else { expect(final?.status).toBe(Status.ASSIGNED); expect(final?.dispatch.version).toBe(1); expect(await HomeCareRequestHistory.countDocuments({ request_id: item._id, event_type: Event.CLAIMED_BY_NURSE })).toBe(1); } });
    test('admin reject versus nurse claim has one winner and corresponding history', async () => { const item = await request(); const results = await Promise.allSettled([patientService.rejectForAdmin(String(item._id), 'reason', adminActor()), dispatchService.claim(String(nurseA.user_id), String(item._id), nurseActor(nurseA))]); expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1); expect((results.find(x => x.status === 'rejected') as any).reason).toMatchObject({ status: 409 }); const final = await HomeCareRequest.findById(item._id); expect([Status.REJECTED, Status.ASSIGNED]).toContain(final?.status as typeof Status.REJECTED | typeof Status.ASSIGNED); expect(await HomeCareRequestHistory.countDocuments({ request_id: item._id })).toBe(1); expect(final?.dispatch.version).toBe(1); });
    test('admin confirm versus nurse claim permits valid serializations only', async () => { const item = await request(); const results = await Promise.allSettled([patientService.updateStatus(String(item._id), Status.CONFIRMED, adminActor()), dispatchService.claim(String(nurseA.user_id), String(item._id), nurseActor(nurseA))]); expect(results.filter(x => x.status === 'fulfilled').length).toBeGreaterThanOrEqual(1); const final = await HomeCareRequest.findById(item._id); expect(final?.status).toBe(Status.ASSIGNED); expect(final?.dispatch.status).toBe(Dispatch.CLAIMED); expect(String(final?.dispatch.nurse_id)).toBe(String(nurseA._id)); const confirmations = await HomeCareRequestHistory.countDocuments({ request_id: item._id, event_type: Event.STATUS_CHANGED }); const claims = await HomeCareRequestHistory.countDocuments({ request_id: item._id, event_type: Event.CLAIMED_BY_NURSE }); expect(claims).toBe(1); expect([0, 1]).toContain(confirmations); expect(final?.dispatch.version).toBe(confirmations + 1); });
    test('admin cancel versus nurse complete has one terminal winner', async () => { const item = await request(Status.IN_PROGRESS, nurseA, 4); const results = await Promise.allSettled([patientService.cancelForAdmin(String(item._id), 'reason', adminActor()), dispatchService.transition(String(nurseA.user_id), String(item._id), Status.IN_PROGRESS, Status.COMPLETED, nurseActor(nurseA))]); expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1); expect((results.find(x => x.status === 'rejected') as any).reason).toMatchObject({ status: 409 }); const final = await HomeCareRequest.findById(item._id); expect([Status.CANCELLED, Status.COMPLETED]).toContain(final?.status as typeof Status.CANCELLED | typeof Status.COMPLETED); expect(final?.dispatch.status).toBe(Dispatch.CLOSED); expect(final?.dispatch.version).toBe(5); const cancelled = await HomeCareRequestHistory.countDocuments({ request_id: item._id, event_type: Event.REQUEST_CANCELLED }); const completed = await HomeCareRequestHistory.countDocuments({ request_id: item._id, event_type: Event.COMPLETED }); expect(cancelled + completed).toBe(1); if (final?.status === Status.COMPLETED) expect(final.cancelled_at).toBeNull(); });
});
