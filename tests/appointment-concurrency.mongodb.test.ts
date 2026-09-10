import { afterAll, beforeAll, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import mongoose, { type ClientSession } from 'mongoose';
import { Value } from '@sinclair/typebox/value';
import Appointment from '../src/models/appointments.model';
import AppointmentHistory from '../src/models/appointment-history.model';
import AppointmentCounter from '../src/models/appointment-counter.model';
import AppointmentDayLock from '../src/models/appointment-day-lock.model';
import Patient from '../src/models/patients.model';
import Doctor from '../src/models/doctors.model';
import Clinic from '../src/models/clinics.model';
import DoctorAvailability from '../src/models/doctor-availability.model';
import DoctorAvailabilityException from '../src/models/doctor-availability-exception.model';
import Notification from '../src/models/notifications.model';
import NotificationRecipient from '../src/models/notification-recipient.model';
import NotificationDelivery from '../src/models/notification-delivery.model';
import { AppointmentWorkflowService } from '../src/services/appointment-workflow.service';
import appointmentSlotService from '../src/services/appointment-slot.service';
import { APPOINTMENT_REMINDER_OFFSETS_MINUTES } from '../src/services/appointment-reminder.service';
import { assertAppointmentTransactionSupport } from '../src/services/appointment-transaction.service';
import { addMinutes, localDateTimeToUtc, localDayOfWeek, toBaghdadLocal } from '../src/services/appointment-time.service';
import { DomainError } from '../src/services/domain-error';
import { APPOINTMENT_DAILY_CAP_COUNTING_STATUSES, AppointmentActorTypeEnum, AppointmentBeneficiaryTypeEnum, IAppointmentBookingSourceEnum, IAppointmentStatusEnum } from '../src/interfaces/appointment.interface';
import { formatAppointment } from '../src/services/appointment.service';
import { AppointmentResponseSchema, AppointmentSchema } from '../src/schemas/appointment-response.schema';
import { AvailabilityExceptionTypeEnum } from '../src/interfaces/doctor-availability.interface';
import { INotificationDeliveryStatusEnum } from '../src/interfaces/notification-delivery.interface';
import { INotificationStatusEnum, INotificationTypeEnum } from '../src/interfaces/notification.interface';

const mongoUri = process.env.MONGODB_TEST_URI;
const describeWithMongo = mongoUri ? describe : describe.skip;
setDefaultTimeout(30_000);

describeWithMongo('Appointment concurrency against MongoDB replica set', () => {
    const databaseName = `cannula_appointments_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const patientId = new mongoose.Types.ObjectId();
    const patientUserId = new mongoose.Types.ObjectId();
    const doctorId = new mongoose.Types.ObjectId();
    const clinicId = new mongoose.Types.ObjectId();
    const otherClinicId = new mongoose.Types.ObjectId();
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
        await Promise.all([Patient.syncIndexes(), Doctor.syncIndexes(), Clinic.syncIndexes(), DoctorAvailability.syncIndexes(), DoctorAvailabilityException.syncIndexes(), Appointment.syncIndexes(), AppointmentHistory.syncIndexes(), AppointmentCounter.syncIndexes(), AppointmentDayLock.syncIndexes(), Notification.syncIndexes(), NotificationRecipient.syncIndexes(), NotificationDelivery.syncIndexes()]);
    });
    afterAll(async () => { if (mongoose.connection.db) await mongoose.connection.db.dropDatabase(); await mongoose.disconnect(); });
    beforeEach(async () => {
        await Promise.all([Appointment.deleteMany({}), AppointmentHistory.deleteMany({}), AppointmentCounter.deleteMany({}), AppointmentDayLock.deleteMany({}), Patient.deleteMany({}), Doctor.deleteMany({}), Clinic.deleteMany({}), DoctorAvailability.deleteMany({}), DoctorAvailabilityException.deleteMany({}), Notification.deleteMany({}), NotificationRecipient.deleteMany({}), NotificationDelivery.deleteMany({})]);
        await Patient.collection.insertOne({ _id: patientId, user_id: patientUserId, full_name: 'مريض اختبار', status: 'active', createdAt: new Date(), updatedAt: new Date() });
    });

    async function seedRealSchedule(options: { bufferBefore?: number; bufferAfter?: number; leadHours?: number; autoConfirm?: boolean } = {}) {
        const specialty = new mongoose.Types.ObjectId();
        await Doctor.collection.insertOne({
            _id: doctorId, user_id: new mongoose.Types.ObjectId(), full_name: 'طبيب أصلي', display_name: 'طبيب أصلي', primary_specialty_id: specialty,
            specialty_ids: [specialty], clinic_ids: [clinicId, otherClinicId], license_verified: true, verification_status: 'verified', status: 'active', accepting_new_patients: true,
            appointment_duration: 30, slot_interval: 30, buffer_before: options.bufferBefore ?? 0, buffer_after: options.bufferAfter ?? 0,
            booking_lead_time_hours: options.leadHours ?? 1, cancellation_window_hours: 0, max_appointments_per_day: 30,
            consultation_fee: 25000, currency: 'IQD', accept_auto_booking: options.autoConfirm ?? false, allow_reschedule: true,
        });
        await Clinic.collection.insertMany([
            { _id: clinicId, name: 'عيادة أصلية', address: 'بغداد الأصلية', status: 'active' },
            { _id: otherClinicId, name: 'عيادة ثانية', address: 'بغداد الثانية', status: 'active' },
        ]);
        await DoctorAvailability.create([
            { doctor_id: doctorId, clinic_id: clinicId, day_of_week: localDayOfWeek(date), periods: [{ start_time: '09:00', end_time: '13:00' }, { start_time: '16:00', end_time: '20:00' }], is_active: true },
            { doctor_id: doctorId, clinic_id: otherClinicId, day_of_week: localDayOfWeek(date), periods: [{ start_time: '09:00', end_time: '13:00' }, { start_time: '16:00', end_time: '20:00' }], is_active: true },
        ]);
    }

    test('two simultaneous attempts for the same slot yield exactly one appointment', async () => {
        const results = await Promise.allSettled([service.create(booking('09:00'), actor), service.create(booking('09:00'), actor)]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
        expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'APPOINTMENT_SLOT_UNAVAILABLE' } });
        expect(await Appointment.countDocuments()).toBe(1);
        expect(await AppointmentHistory.countDocuments({ event_type: 'CREATED' })).toBe(1);
    });

    test('same Doctor and time across different clinics still has exactly one winner', async () => {
        const otherClinic = new mongoose.Types.ObjectId();
        const results = await Promise.allSettled([
            service.create(booking('09:00'), actor),
            service.create({ ...booking('09:00'), clinicId: String(otherClinic) }, actor),
        ]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'APPOINTMENT_SLOT_UNAVAILABLE' } });
        expect(await Appointment.countDocuments({ doctor_id: doctorId })).toBe(1);
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

    test('AppointmentDayLock revisions serialize normally and stale documents do not block later bookings', async () => {
        await AppointmentDayLock.create({ _id: `${doctorId}:${date}`, revision: 40, touched_at: new Date('2020-01-01') });
        await Promise.all([service.create(booking('09:00'), actor), service.create(booking('10:00'), actor)]);
        const lock = await AppointmentDayLock.findById(`${doctorId}:${date}`);
        expect(lock?.revision).toBe(42);
        expect(lock?.touched_at.getTime()).toBeGreaterThan(new Date('2020-01-01').getTime());
    });

    test('failure after Appointment creation rolls back appointment, history, counter, and day lock', async () => {
        const failingService = new AppointmentWorkflowService(undefined, fakeSlots as any, {
            append: async () => { throw new Error('forced notification transaction failure'); },
            scheduleForConfirmedAppointment: async () => undefined,
            cancelFutureForAppointment: async () => undefined,
        });
        await expect(failingService.create(booking('09:00'), actor)).rejects.toThrow('forced notification transaction failure');
        expect(await Appointment.countDocuments()).toBe(0);
        expect(await AppointmentHistory.countDocuments()).toBe(0);
        expect(await AppointmentCounter.countDocuments()).toBe(0);
        expect(await AppointmentDayLock.countDocuments()).toBe(0);
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

    test('29 plus two concurrent bookings in the same clinic never exceeds 30', async () => {
        await Appointment.insertMany(completedRows(29));
        const results = await Promise.allSettled([service.create(booking('09:00'), actor), service.create(booking('10:00'), actor)]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'APPOINTMENT_DAILY_CAP_REACHED' } });
        expect(await Appointment.countDocuments({ doctor_id: doctorId, local_date: date, status: { $in: APPOINTMENT_DAILY_CAP_COUNTING_STATUSES } })).toBe(30);
    });

    test('canonical capacity filter excludes persisted cancelled and rescheduled rows', async () => {
        const rows = completedRows(30).map((row, index) => ({ ...row, status: index % 2 ? IAppointmentStatusEnum.CANCELLED : IAppointmentStatusEnum.RESCHEDULED }));
        await Appointment.insertMany(rows);
        expect(await Appointment.countDocuments({ doctor_id: doctorId, local_date: date, status: { $in: APPOINTMENT_DAILY_CAP_COUNTING_STATUSES } })).toBe(0);
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

    test('reschedule racing another destination booking has one consistent slot owner', async () => {
        const original = await service.create(booking('09:00'), actor);
        const destination = booking('10:00');
        const results = await Promise.allSettled([
            service.reschedule(String(original._id), { date, startsAt: destination.startsAt }, actor),
            service.create(destination, actor),
        ]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        const destinationStart = new Date(destination.startsAt);
        expect(await Appointment.countDocuments({ doctor_id: doctorId, starts_at: destinationStart, status: { $in: ['pending', 'confirmed', 'checked_in', 'in_progress'] } })).toBe(1);
        const old = await Appointment.findById(original._id);
        const rescheduleWon = results[0]?.status === 'fulfilled';
        expect(old?.status).toBe(rescheduleWon ? IAppointmentStatusEnum.RESCHEDULED : IAppointmentStatusEnum.PENDING);
        expect(Boolean(old?.rescheduled_to)).toBe(rescheduleWon);
    });

    test('cancellation racing check-in produces one state and matching history', async () => {
        const original = await service.create(booking('09:00'), actor);
        await Appointment.updateOne({ _id: original._id }, { $set: { status: IAppointmentStatusEnum.CONFIRMED } });
        const adminActor = { type: AppointmentActorTypeEnum.ADMIN, userId: String(new mongoose.Types.ObjectId()) };
        const doctorActor = { type: AppointmentActorTypeEnum.DOCTOR, userId: String(new mongoose.Types.ObjectId()), doctorId: String(doctorId) };
        const results = await Promise.allSettled([
            service.cancel(String(original._id), adminActor, 'سباق إلغاء'),
            service.checkIn(String(original._id), doctorActor),
        ]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        const final = await Appointment.findById(original._id);
        if (!final) throw new Error('Appointment disappeared during cancellation/check-in race');
        expect(final.status === IAppointmentStatusEnum.CANCELLED || final.status === IAppointmentStatusEnum.CHECKED_IN).toBe(true);
        if (final.status === IAppointmentStatusEnum.CANCELLED) {
            expect(final.cancellation).toMatchObject({ reason: 'سباق إلغاء', actor_type: AppointmentActorTypeEnum.ADMIN });
            expect(final.cancellation?.at).toBeInstanceOf(Date);
        } else {
            expect(final?.cancellation).toBeNull();
        }
        expect(await AppointmentHistory.countDocuments({ appointment_id: original._id })).toBe(2);
    });

    test('Patient and Doctor actors persist truthful cancellation metadata', async () => {
        await seedRealSchedule({ leadHours: 0 });
        const patientAppointment = await service.create(booking('09:00'), actor);
        const doctorAppointment = await service.create(booking('10:00'), actor);
        const patientActor = {
            type: AppointmentActorTypeEnum.PATIENT,
            userId: String(patientUserId),
            patientId: String(patientId),
        };
        const doctorUserId = new mongoose.Types.ObjectId();
        const doctorActor = {
            type: AppointmentActorTypeEnum.DOCTOR,
            userId: String(doctorUserId),
            doctorId: String(doctorId),
        };

        const patientCancelled = await service.cancel(String(patientAppointment._id), patientActor, 'إلغاء المريض', new Date('2026-09-01T00:00:00.000Z'));
        const doctorCancelled = await service.cancel(String(doctorAppointment._id), doctorActor, 'إلغاء الطبيب', new Date('2026-09-01T00:00:00.000Z'));

        expect(patientCancelled.cancellation).toMatchObject({ reason: 'إلغاء المريض', actor_type: AppointmentActorTypeEnum.PATIENT, actor_user_id: patientUserId });
        expect(doctorCancelled.cancellation).toMatchObject({ reason: 'إلغاء الطبيب', actor_type: AppointmentActorTypeEnum.DOCTOR, actor_user_id: doctorUserId });
        expect(patientCancelled.workflow_version).toBe(1);
        expect(doctorCancelled.workflow_version).toBe(1);
        expect(await AppointmentHistory.countDocuments({ event_type: 'CANCELLED' })).toBe(2);
        expect(Value.Check(AppointmentSchema, formatAppointment(patientCancelled))).toBe(true);
        expect(Value.Check(AppointmentSchema, formatAppointment(doctorCancelled))).toBe(true);
    });

    test('real hydrated create, cancel, and reschedule records satisfy the strict response DTO', async () => {
        const created = await service.create(booking('09:00'), actor);
        expect(created.cancellation).toBeNull();
        expect(Value.Check(AppointmentSchema, formatAppointment(created))).toBe(true);
        expect(Value.Check(AppointmentResponseSchema, { error: false, message: 'created', data: formatAppointment(created) })).toBe(true);

        const cancelled = await service.cancel(String(created._id), actor, 'اختبار');
        expect(cancelled.cancellation).toMatchObject({ reason: 'اختبار', actor_type: AppointmentActorTypeEnum.ADMIN });
        expect(Value.Check(AppointmentSchema, formatAppointment(cancelled))).toBe(true);

        const source = await service.create(booking('10:00'), actor);
        const moved = await service.reschedule(String(source._id), { date, startsAt: booking('11:00').startsAt }, actor);
        const hydratedOld = await Appointment.findById(source._id);
        const hydratedReplacement = await Appointment.findById(moved.appointment._id);
        expect(Value.Check(AppointmentSchema, formatAppointment(hydratedOld))).toBe(true);
        expect(Value.Check(AppointmentSchema, formatAppointment(hydratedReplacement))).toBe(true);
        expect(String(hydratedOld?.rescheduled_to)).toBe(String(hydratedReplacement?._id));
        expect(String(hydratedReplacement?.rescheduled_from)).toBe(String(hydratedOld?._id));
    });

    test('real weekly schedule and exception precedence are deterministic', async () => {
        await seedRealSchedule();
        const input = { doctorId: String(doctorId), clinicId: String(clinicId), date };
        const normal = await appointmentSlotService.getSlots(input, { now: new Date('2026-09-01T00:00:00.000Z'), enforceLeadTime: false });
        expect(normal.slots.map(slot => slot.localStartsAt)).toEqual(expect.arrayContaining(['09:00', '16:00']));

        await DoctorAvailabilityException.create({ doctor_id: doctorId, clinic_id: null, local_date: date, type: AvailabilityExceptionTypeEnum.CLOSED, periods: [], created_by_type: AppointmentActorTypeEnum.ADMIN });
        const doctorClosed = await appointmentSlotService.getSlots(input, { now: new Date('2026-09-01T00:00:00.000Z'), enforceLeadTime: false });
        expect(doctorClosed.availabilityStatus).toBe('DOCTOR_CLOSED');
        expect(doctorClosed.slots).toHaveLength(0);

        await DoctorAvailabilityException.create({ doctor_id: doctorId, clinic_id: clinicId, local_date: date, type: AvailabilityExceptionTypeEnum.CUSTOM_HOURS, periods: [{ start_time: '11:00', end_time: '12:00' }], created_by_type: AppointmentActorTypeEnum.ADMIN });
        const clinicOverride = await appointmentSlotService.getSlots(input, { now: new Date('2026-09-01T00:00:00.000Z'), enforceLeadTime: false });
        const otherClinic = await appointmentSlotService.getSlots({ ...input, clinicId: String(otherClinicId) }, { now: new Date('2026-09-01T00:00:00.000Z'), enforceLeadTime: false });
        expect(clinicOverride.slots.map(slot => slot.localStartsAt)).toEqual(['11:00', '11:30']);
        expect(otherClinic.availabilityStatus).toBe('DOCTOR_CLOSED');
    });

    test('GET slot generation and POST slot validation agree at the exact one-hour lead boundary', async () => {
        await seedRealSchedule({ leadHours: 1 });
        const input = { doctorId: String(doctorId), clinicId: String(clinicId), date };
        const startsAt = localDateTimeToUtc(date, '09:00');
        const exactNow = addMinutes(startsAt, -60);
        const shortNow = new Date(exactNow.getTime() + 1000);
        const earlierNow = new Date(exactNow.getTime() - 1000);

        const tooSoon = await appointmentSlotService.getAvailability(input, { now: shortNow, includeSuggestions: false });
        expect(tooSoon.slots.some(slot => slot.startsAt === startsAt.toISOString())).toBe(false);
        let tooSoonError: unknown;
        try { await appointmentSlotService.requireSlot({ ...input, startsAt: startsAt.toISOString() }, { now: shortNow }); }
        catch (error) { tooSoonError = error; }
        expect(tooSoonError).toMatchObject({ code: 'APPOINTMENT_TOO_SOON' });

        for (const now of [exactNow, earlierNow]) {
            const availability = await appointmentSlotService.getAvailability(input, { now, includeSuggestions: false });
            expect(availability.slots.some(slot => slot.startsAt === startsAt.toISOString())).toBe(true);
            const required = await appointmentSlotService.requireSlot({ ...input, startsAt: startsAt.toISOString() }, { now });
            expect(required.slot.startsAt).toBe(startsAt.toISOString());
        }
    });

    test('persisted blocked buffers exclude a visibly non-overlapping cross-clinic slot', async () => {
        await seedRealSchedule({ bufferBefore: 10, bufferAfter: 10, leadHours: 0 });
        await DoctorAvailability.updateMany({}, { $set: { periods: [{ start_time: '08:00', end_time: '13:00' }] } });
        const realService = new AppointmentWorkflowService(undefined, appointmentSlotService, {
            append: async () => undefined, scheduleForConfirmedAppointment: async () => undefined, cancelFutureForAppointment: async () => undefined,
        });
        await realService.create({ ...booking('09:00'), clinicId: String(clinicId) }, actor, new Date('2026-09-01T00:00:00.000Z'));
        const result = await appointmentSlotService.getSlots({ doctorId: String(doctorId), clinicId: String(otherClinicId), date }, { now: new Date('2026-09-01T00:00:00.000Z'), enforceLeadTime: false });
        expect(result.slots.some(slot => slot.localStartsAt === '09:30')).toBe(false);
        expect(result.slots.some(slot => slot.localStartsAt === '10:00')).toBe(true);
    });

    test('Baghdad midnight instants persist and count under the intended local dates', async () => {
        const late = localDateTimeToUtc('2026-09-10', '23:30');
        const midnight = localDateTimeToUtc('2026-09-11', '00:00');
        const after = localDateTimeToUtc('2026-09-11', '00:30');
        expect([late.toISOString(), midnight.toISOString(), after.toISOString()]).toEqual([
            '2026-09-10T20:30:00.000Z', '2026-09-10T21:00:00.000Z', '2026-09-10T21:30:00.000Z',
        ]);
        const rows = [
            { ...completedRows(1, '2026-09-10', 'TZL')[0], starts_at: late, ends_at: addMinutes(late, 1) },
            { ...completedRows(1, '2026-09-11', 'TZM')[0], starts_at: midnight, ends_at: addMinutes(midnight, 1) },
            { ...completedRows(1, '2026-09-11', 'TZA')[0], starts_at: after, ends_at: addMinutes(after, 1) },
        ];
        await Appointment.insertMany(rows);
        expect(await Appointment.countDocuments({ doctor_id: doctorId, local_date: '2026-09-10' })).toBe(1);
        expect(await Appointment.countDocuments({ doctor_id: doctorId, local_date: '2026-09-11' })).toBe(2);
    });

    test('persisted appointment snapshots remain unchanged after source records change', async () => {
        await seedRealSchedule({ leadHours: 0 });
        const realService = new AppointmentWorkflowService(undefined, appointmentSlotService, {
            append: async () => undefined, scheduleForConfirmedAppointment: async () => undefined, cancelFutureForAppointment: async () => undefined,
        });
        const created = await realService.create(booking('09:00'), actor, new Date('2026-09-01T00:00:00.000Z'));
        await Doctor.updateOne({ _id: doctorId }, { $set: { display_name: 'طبيب معدل', consultation_fee: 99999 } });
        await Clinic.updateOne({ _id: clinicId }, { $set: { name: 'عيادة معدلة', address: 'عنوان معدل' } });
        const hydrated = await Appointment.findById(created._id);
        const dto = formatAppointment(hydrated);
        expect(dto.doctor.display_name).toBe('طبيب أصلي');
        expect(dto.clinic).toEqual(expect.objectContaining({ name: 'عيادة أصلية', address: 'بغداد الأصلية' }));
        expect(dto.pricing).toEqual(expect.objectContaining({ fee: 25000, currency: 'IQD' }));
        expect(Value.Check(AppointmentSchema, dto)).toBe(true);
    });

    test('confirmed reminders persist and cancellation atomically cancels future undelivered delivery rows', async () => {
        await seedRealSchedule({ leadHours: 0, autoConfirm: true });
        const realService = new AppointmentWorkflowService();
        const created = await realService.create(booking('09:00'), actor, new Date('2026-09-08T00:00:00.000Z'));
        const reminders = await Notification.find({ appointment_id: created._id, type: INotificationTypeEnum.APPOINTMENT_REMINDER });
        expect(reminders).toHaveLength(2);
        expect(await NotificationDelivery.countDocuments({ notification_id: { $in: reminders.map(item => item._id) }, status: INotificationDeliveryStatusEnum.PENDING })).toBe(2);

        await realService.cancel(String(created._id), actor, 'إلغاء اختبار', new Date('2026-09-08T01:00:00.000Z'));
        expect(await Notification.countDocuments({ _id: { $in: reminders.map(item => item._id) }, status: INotificationStatusEnum.CANCELLED })).toBe(2);
        expect(await NotificationDelivery.countDocuments({ notification_id: { $in: reminders.map(item => item._id) }, status: INotificationDeliveryStatusEnum.CANCELLED })).toBe(2);
    });

    test('rescheduling a confirmed appointment cancels old reminders and creates replacement reminders at 24h and 2h', async () => {
        await seedRealSchedule({ leadHours: 0, autoConfirm: true });
        const realService = new AppointmentWorkflowService();
        const now = new Date('2026-09-08T00:00:00.000Z');
        const original = await realService.create(booking('09:00'), actor, now);
        const moved = await realService.reschedule(String(original._id), { date, startsAt: booking('10:00').startsAt }, actor, now);

        const oldReminders = await Notification.find({ appointment_id: original._id, type: INotificationTypeEnum.APPOINTMENT_REMINDER }).sort({ scheduled_at: 1 });
        const replacementReminders = await Notification.find({ appointment_id: moved.appointment._id, type: INotificationTypeEnum.APPOINTMENT_REMINDER }).sort({ scheduled_at: 1 });
        expect(oldReminders).toHaveLength(2);
        expect(oldReminders.every(item => item.status === INotificationStatusEnum.CANCELLED)).toBe(true);
        expect(replacementReminders).toHaveLength(APPOINTMENT_REMINDER_OFFSETS_MINUTES.length);
        expect(replacementReminders.map(item => item.scheduled_at?.toISOString())).toEqual([
            '2026-09-09T07:00:00.000Z',
            '2026-09-10T05:00:00.000Z',
        ]);
        expect(await NotificationDelivery.countDocuments({ notification_id: { $in: replacementReminders.map(item => item._id) }, status: INotificationDeliveryStatusEnum.PENDING })).toBe(2);
    });

    test('completion and no-show transitions cancel their future undelivered reminders', async () => {
        await seedRealSchedule({ leadHours: 0, autoConfirm: true });
        const realService = new AppointmentWorkflowService();
        const doctorActor = { type: AppointmentActorTypeEnum.DOCTOR, userId: String(new mongoose.Types.ObjectId()), doctorId: String(doctorId) };
        const completed = await realService.create(booking('09:00'), actor, new Date('2026-09-08T00:00:00.000Z'));
        const noShow = await realService.create(booking('10:00'), actor, new Date('2026-09-08T00:00:00.000Z'));

        await realService.checkIn(String(completed._id), doctorActor);
        await realService.start(String(completed._id), doctorActor);
        await realService.complete(String(completed._id), doctorActor);
        await realService.noShow(String(noShow._id), doctorActor);

        for (const appointmentId of [completed._id, noShow._id]) {
            const reminders = await Notification.find({ appointment_id: appointmentId, type: INotificationTypeEnum.APPOINTMENT_REMINDER });
            expect(reminders).toHaveLength(2);
            expect(reminders.every(item => item.status === INotificationStatusEnum.CANCELLED)).toBe(true);
            expect(await NotificationDelivery.countDocuments({ notification_id: { $in: reminders.map(item => item._id) }, status: INotificationDeliveryStatusEnum.CANCELLED })).toBe(2);
        }
    });

    test('real Appointment-related collections expose the expected indexes', async () => {
        const names = async (model: mongoose.Model<any>) => (await model.collection.listIndexes().toArray()).map(index => index.name);
        expect(await names(Appointment)).toEqual(expect.arrayContaining(['appointment_number_1', 'doctor_id_1_starts_at_1', 'doctor_id_1_local_date_1_blocked_starts_at_1_blocked_ends_at_1', 'patient_id_1_starts_at_-1']));
        expect(await names(AppointmentDayLock)).toContain('_id_');
        expect(await names(AppointmentCounter)).toContain('_id_');
        expect(await names(AppointmentHistory)).toContain('appointment_id_1_createdAt_1__id_1');
        expect(await names(DoctorAvailability)).toEqual(expect.arrayContaining(['doctor_id_1_clinic_id_1_day_of_week_1', 'doctor_id_1_day_of_week_1_is_active_1']));
        expect(await names(DoctorAvailabilityException)).toEqual(expect.arrayContaining(['doctor_id_1_clinic_id_1_local_date_1', 'doctor_id_1_local_date_1']));
        expect(await names(Notification)).toContain('appointment_id_1');
    });
});
