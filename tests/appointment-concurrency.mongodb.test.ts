import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import mongoose, { type ClientSession } from 'mongoose';
import Appointment from '../src/models/appointments.model';
import AppointmentHistory from '../src/models/appointment-history.model';
import AppointmentCounter from '../src/models/appointment-counter.model';
import AppointmentDayLock from '../src/models/appointment-day-lock.model';
import Patient from '../src/models/patients.model';
import { AppointmentWorkflowService } from '../src/services/appointment-workflow.service';
import { assertAppointmentTransactionSupport } from '../src/services/appointment-transaction.service';
import { addMinutes, localDateTimeToUtc, toBaghdadLocal } from '../src/services/appointment-time.service';
import { DomainError } from '../src/services/domain-error';
import { APPOINTMENT_DAILY_CAP_COUNTING_STATUSES, AppointmentActorTypeEnum, AppointmentBeneficiaryTypeEnum, IAppointmentBookingSourceEnum } from '../src/interfaces/appointment.interface';

const mongoUri = process.env.MONGODB_TEST_URI;
const describeWithMongo = mongoUri ? describe : describe.skip;

describeWithMongo('Appointment concurrency against MongoDB replica set', () => {
    const databaseName = `cannula_appointments_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const patientId = new mongoose.Types.ObjectId();
    const doctorId = new mongoose.Types.ObjectId();
    const clinicId = new mongoose.Types.ObjectId();
    const date = '2026-09-10';

    const fakeSlots = {
        async getAvailability() { return { nextAvailable: null, nextAvailableOptions: [] }; },
        async requireSlot(input: any, options: { session?: ClientSession | null; excludeAppointmentId?: string | null } = {}) {
            const startsAt = new Date(input.startsAt), endsAt = addMinutes(startsAt, 30);
            const blockedStartsAt = addMinutes(startsAt, -10), blockedEndsAt = addMinutes(endsAt, 10);
            let query = Appointment.findOne({ doctor_id: doctorId, status: { $in: ['pending', 'confirmed', 'checked_in', 'in_progress'] }, blocked_starts_at: { $lt: blockedEndsAt }, blocked_ends_at: { $gt: blockedStartsAt } });
            if (options.session) query = query.session(options.session);
            if (await query.exec()) throw new DomainError('الموعد المختار غير متاح', 409, 'APPOINTMENT_SLOT_UNAVAILABLE');
            let countQuery = Appointment.countDocuments({ doctor_id: doctorId, local_date: input.date, status: { $in: APPOINTMENT_DAILY_CAP_COUNTING_STATUSES }, ...(options.excludeAppointmentId ? { _id: { $ne: new mongoose.Types.ObjectId(options.excludeAppointmentId) } } : {}) });
            if (options.session) countQuery = countQuery.session(options.session);
            if (await countQuery.exec() >= 30) throw new DomainError('اكتمل الحد الأقصى لحجوزات الطبيب لهذا اليوم', 409, 'APPOINTMENT_DAILY_CAP_REACHED');
            const local = toBaghdadLocal(startsAt);
            return {
                slot: { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), localStartsAt: local.time, localEndsAt: toBaghdadLocal(endsAt).time, blockedStartsAt: blockedStartsAt.toISOString(), blockedEndsAt: blockedEndsAt.toISOString() },
                context: { doctor: { _id: doctorId, display_name: 'طبيب اختبار', profile_photo: null, consultation_fee: 25000, currency: 'IQD', accept_auto_booking: false }, clinic: { _id: new mongoose.Types.ObjectId(input.clinicId), name: 'عيادة اختبار', address: 'بغداد' }, specialty: null },
            };
        },
    };
    const service = new AppointmentWorkflowService(undefined, fakeSlots as any, {
        append: async () => undefined,
        scheduleForConfirmedAppointment: async () => undefined,
        cancelFutureForAppointment: async () => undefined,
    });
    const actor = { type: AppointmentActorTypeEnum.ADMIN };
    const booking = (localTime: string) => ({
        patientId: String(patientId), doctorId: String(doctorId), clinicId: String(clinicId), date,
        startsAt: localDateTimeToUtc(date, localTime).toISOString(), beneficiary: { type: AppointmentBeneficiaryTypeEnum.SELF }, source: IAppointmentBookingSourceEnum.ADMIN_PANEL,
    });
    const completedRows = (count: number, localDate = date, prefix = 'SEED') => Array.from({ length: count }, (_, index) => ({
        appointment_number: `APP-2026-${prefix}${String(index).padStart(2, '0')}`, patient_id: patientId, beneficiary_type: 'SELF', doctor_id: doctorId,
        clinic_id: clinicId, local_date: localDate, starts_at: localDateTimeToUtc(localDate, '00:00'), ends_at: localDateTimeToUtc(localDate, '00:01'),
        blocked_starts_at: new Date(Date.UTC(2020, 0, 1, 0, index * 2)), blocked_ends_at: new Date(Date.UTC(2020, 0, 1, 0, index * 2 + 1)), status: 'completed', booking_source: 'admin_panel',
        snapshot: { doctor: { display_name: 'طبيب اختبار' }, clinic: { name: 'عيادة', address: 'بغداد' }, specialty: null, beneficiary: { type: 'SELF', display_name: 'مريض' }, pricing: { fee: 0, currency: 'IQD' } }, payment_status: 'unpaid', workflow_version: 0,
    }));

    beforeAll(async () => {
        await mongoose.connect(mongoUri!, { dbName: databaseName });
        await assertAppointmentTransactionSupport();
        await Promise.all([Patient.syncIndexes(), Appointment.syncIndexes(), AppointmentHistory.syncIndexes(), AppointmentCounter.syncIndexes(), AppointmentDayLock.syncIndexes()]);
    });
    afterAll(async () => { if (mongoose.connection.db) await mongoose.connection.db.dropDatabase(); await mongoose.disconnect(); });
    beforeEach(async () => {
        await Promise.all([Appointment.deleteMany({}), AppointmentHistory.deleteMany({}), AppointmentCounter.deleteMany({}), AppointmentDayLock.deleteMany({}), Patient.deleteMany({})]);
        await Patient.collection.insertOne({ _id: patientId, full_name: 'مريض اختبار', status: 'active', createdAt: new Date(), updatedAt: new Date() });
    });

    test('two simultaneous attempts for the same slot yield exactly one appointment', async () => {
        const results = await Promise.allSettled([service.create(booking('09:00'), actor), service.create(booking('09:00'), actor)]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
        expect(await Appointment.countDocuments()).toBe(1);
        expect(await AppointmentHistory.countDocuments({ event_type: 'CREATED' })).toBe(1);
    });

    test('concurrent partial overlap and buffer bypass attempts have one winner', async () => {
        const results = await Promise.allSettled([service.create(booking('09:00'), actor), service.create(booking('09:20'), actor), service.create(booking('09:40'), actor)]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(await Appointment.countDocuments()).toBe(1);
    });

    test('atomic counter keeps appointment numbers unique under concurrent non-overlapping bookings', async () => {
        const times = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00'];
        const results = await Promise.all(times.map(time => service.create(booking(time), actor)));
        expect(new Set(results.map(item => item.appointment_number)).size).toBe(times.length);
        expect(await Appointment.countDocuments()).toBe(times.length);
    });

    test('reschedule atomically links a replacement and writes both timelines', async () => {
        const original = await service.create(booking('09:00'), actor);
        const result = await service.reschedule(String(original._id), { date, startsAt: localDateTimeToUtc(date, '10:00').toISOString(), reason: 'وقت جديد' }, actor);
        const old = await Appointment.findById(original._id), replacement = await Appointment.findById(result.appointment._id);
        expect(old?.status).toBe('rescheduled');
        expect(String(old?.rescheduled_to)).toBe(String(replacement?._id));
        expect(String(replacement?.rescheduled_from)).toBe(String(old?._id));
        expect(await AppointmentHistory.countDocuments({ appointment_id: old?._id, event_type: 'RESCHEDULED_FROM' })).toBe(1);
        expect(await AppointmentHistory.countDocuments({ appointment_id: replacement?._id, event_type: 'RESCHEDULED_TO' })).toBe(1);
    });

    test('failed destination booking rolls back and leaves the original unchanged', async () => {
        const original = await service.create(booking('09:00'), actor);
        await service.create(booking('10:00'), actor);
        const rejection = await service.reschedule(String(original._id), { date, startsAt: localDateTimeToUtc(date, '10:00').toISOString() }, actor).then(() => null, error => error);
        expect(rejection).toMatchObject({ code: 'APPOINTMENT_SLOT_UNAVAILABLE' });
        const unchanged = await Appointment.findById(original._id);
        expect(unchanged?.status).toBe('pending');
        expect(unchanged?.rescheduled_to).toBeNull();
        expect(await Appointment.countDocuments()).toBe(2);
    });

    test('29 plus two concurrent bookings across different clinics never exceeds 30', async () => {
        await Appointment.insertMany(completedRows(29));
        const otherClinic = new mongoose.Types.ObjectId();
        const first = booking('09:00');
        const second = { ...booking('10:00'), clinicId: String(otherClinic) };
        const results = await Promise.allSettled([service.create(first, actor), service.create(second, actor)]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
        expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'APPOINTMENT_DAILY_CAP_REACHED' } });
        expect(await Appointment.countDocuments({ doctor_id: doctorId, local_date: date, status: { $in: APPOINTMENT_DAILY_CAP_COUNTING_STATUSES } })).toBe(30);
    });

    test('same-day reschedule at 30/30 excludes the source and keeps capacity at 30', async () => {
        const original = await service.create(booking('09:00'), actor);
        await Appointment.insertMany(completedRows(29));
        const result = await service.reschedule(String(original._id), { date, startsAt: localDateTimeToUtc(date, '10:00').toISOString() }, actor);
        expect(result.previous.status).toBe('rescheduled');
        expect(await Appointment.countDocuments({ doctor_id: doctorId, local_date: date, status: { $in: APPOINTMENT_DAILY_CAP_COUNTING_STATUSES } })).toBe(30);
    });

    test('destination cap rejection rolls back and preserves the source appointment', async () => {
        const sourceDate = '2026-09-09';
        const original = await service.create({ ...booking('09:00'), date: sourceDate, startsAt: localDateTimeToUtc(sourceDate, '09:00').toISOString() }, actor);
        await Appointment.insertMany(completedRows(30, date, 'DEST'));
        const rejection = await service.reschedule(String(original._id), { date, startsAt: localDateTimeToUtc(date, '10:00').toISOString() }, actor).then(() => null, error => error);
        expect(rejection).toMatchObject({ code: 'APPOINTMENT_DAILY_CAP_REACHED' });
        const unchanged = await Appointment.findById(original._id);
        expect(unchanged?.status).toBe('pending');
        expect(unchanged?.rescheduled_to).toBeNull();
    });
});
