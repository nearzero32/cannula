import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import mongoose from 'mongoose';
import User from '../src/models/users.model';
import Patient from '../src/models/patients.model';
import PatientMedication from '../src/models/patient-medication.model';
import MedicationDose from '../src/models/medication-dose.model';
import Notification from '../src/models/notifications.model';
import NotificationRecipient from '../src/models/notification-recipient.model';
import NotificationDelivery from '../src/models/notification-delivery.model';
import NotificationRead from '../src/models/notification-read.model';
import patientMedicationService from '../src/services/patient-medication.service';
import medicationReminderService from '../src/services/medication-reminder.service';
import medicationDoseService from '../src/services/medication-dose.service';
import notificationService from '../src/services/notification.service';
import { MedicationDoseStatusEnum } from '../src/interfaces/medication-dose.interface';

const uri = process.env.MONGODB_TEST_URI;
const run = uri ? describe : describe.skip;
const now = new Date('2026-09-07T10:00:00.000Z'); // 13:00 Baghdad

run('Medication reminders against MongoDB', () => {
    let userA: any, patientA: any, patientB: any;
    const input = (overrides: any = {}) => ({ name: 'دواء أ', strength_text: '500 mg', dose_instructions: '1 tablet', schedule: { timezone: 'Asia/Baghdad', weekdays: [0,1,2,3,4,5,6], times: ['08:00','20:00'], start_date: '2026-09-07', end_date: null }, reminders_enabled: true, ...overrides });
    beforeAll(async () => { await mongoose.connect(uri!); });
    beforeEach(async () => {
        await mongoose.connection.dropDatabase();
        await Promise.all([User.syncIndexes(), Patient.syncIndexes(), PatientMedication.syncIndexes(), MedicationDose.syncIndexes(), Notification.syncIndexes(), NotificationRecipient.syncIndexes(), NotificationDelivery.syncIndexes(), NotificationRead.syncIndexes()]);
        userA = await User.create({ full_name: 'A', phone: '07700000001', role: 'patient', status: 'active' });
        const userB = await User.create({ full_name: 'B', phone: '07700000002', role: 'patient', status: 'active' });
        patientA = await Patient.create({ user_id: userA._id, full_name: 'A', status: 'active' });
        patientB = await Patient.create({ user_id: userB._id, full_name: 'B', status: 'active' });
    });
    afterAll(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });

    test('create/list/get generate daily multiple-time doses without past occurrences', async () => {
        const medication = await patientMedicationService.create(patientA._id, input(), now);
        expect((await patientMedicationService.list(patientA._id, now))).toHaveLength(1);
        expect((await patientMedicationService.get(patientA._id, String(medication._id), now)).schedule_version).toBe(1);
        const doses = await MedicationDose.find({ medication_id: medication._id }).sort({ scheduled_at: 1 }).lean();
        expect(doses.length).toBeGreaterThan(1);
        expect(doses.every(d => d.scheduled_at > now)).toBe(true);
        expect(doses[0]!.scheduled_at.toISOString()).toBe('2026-09-07T17:00:00.000Z');
    });

    test('generation is idempotent and concurrent-safe', async () => {
        const medication = await patientMedicationService.create(patientA._id, input({ schedule: { timezone: 'Asia/Baghdad', weekdays: [0,2,4], times: ['09:00'], start_date: '2026-09-06', end_date: null } }), now);
        const before = await MedicationDose.countDocuments({ medication_id: medication._id });
        await Promise.all([medicationReminderService.generateForMedication(medication, now), medicationReminderService.generateForMedication(medication, now), medicationReminderService.generateForMedication(medication, now)]);
        expect(await MedicationDose.countDocuments({ medication_id: medication._id })).toBe(before);
        const unique = await MedicationDose.aggregate([{ $match: { medication_id: medication._id } }, { $group: { _id: { version: '$schedule_version', at: '$scheduled_at' }, count: { $sum: 1 } } }, { $match: { count: { $gt: 1 } } }]);
        expect(unique).toHaveLength(0);
    });

    test('in-app reminder is sensitive, delayed, targeted, deduped, and has no delivery', async () => {
        const medication = await patientMedicationService.create(patientA._id, input({ schedule: { timezone: 'Asia/Baghdad', weekdays: [0,1,2,3,4,5,6], times: ['20:00'], start_date: '2026-09-07', end_date: '2026-09-07' } }), now);
        const dose = await MedicationDose.findOne({ medication_id: medication._id }).lean();
        const notification = await Notification.findOne({ 'target.id': dose!._id }).lean();
        expect(notification).toMatchObject({ type: 'medication_reminder', category: 'medications', privacy: 'sensitive', visible_at: dose!.scheduled_at, source: { domain: 'patient_medication', id: medication._id }, target: { type: 'medication_dose', id: dose!._id } });
        expect(await NotificationRecipient.countDocuments({ notification_id: notification!._id, user_id: userA._id })).toBe(1);
        expect(await NotificationDelivery.countDocuments({ notification_id: notification!._id })).toBe(0);
        await Notification.updateOne({ _id: notification!._id }, { $set: { visible_at: new Date(Date.now() + 60_000), expires_at: new Date(Date.now() + 86_400_000) } });
        expect((await notificationService.getMobileInbox({ userId: String(userA._id) }, { page: 1, limit: 20 })).data).toHaveLength(0);
        await Notification.updateOne({ _id: notification!._id }, { $set: { visible_at: new Date(Date.now() - 1), expires_at: new Date(Date.now() + 86_400_000) } });
        expect((await notificationService.getMobileInbox({ userId: String(userA._id) }, { page: 1, limit: 20 })).data).toHaveLength(1);
        await medicationReminderService.generateForMedication(medication, now);
        expect(await Notification.countDocuments({ 'target.id': dose!._id })).toBe(1);
        expect(await NotificationDelivery.countDocuments({})).toBe(0);
    });

    test('schedule changes increment version, cancel future old state, and preserve past history', async () => {
        const medication = await patientMedicationService.create(patientA._id, input(), now);
        await MedicationDose.create({ medication_id: medication._id, patient_id: patientA._id, schedule_version: 1, scheduled_at: new Date('2026-09-07T05:00:00Z'), medication_snapshot: { name: 'old' }, status: 'TAKEN', taken_at: new Date('2026-09-07T05:01:00Z'), recorded_at: new Date('2026-09-07T05:01:00Z') });
        const result = await patientMedicationService.update(patientA._id, String(medication._id), { schedule: { times: ['21:00'] } }, now);
        expect(result.schedule_version).toBe(2);
        expect(await MedicationDose.countDocuments({ medication_id: medication._id, schedule_version: 1, scheduled_at: { $gt: now }, status: 'CANCELLED' })).toBeGreaterThan(0);
        expect(await MedicationDose.countDocuments({ medication_id: medication._id, schedule_version: 1, scheduled_at: { $lt: now }, status: 'TAKEN' })).toBe(1);
        expect(await Notification.countDocuments({ source: { domain: 'patient_medication', id: medication._id }, visible_at: { $gt: now }, status: { $ne: 'cancelled' }, dedupe_key: /:1:dose:/ })).toBe(0);
        expect(await MedicationDose.countDocuments({ medication_id: medication._id, schedule_version: 2, status: 'PENDING' })).toBeGreaterThan(0);
    });

    test('information-only edit preserves version and updates future snapshots', async () => {
        const medication = await patientMedicationService.create(patientA._id, input(), now);
        const result = await patientMedicationService.update(patientA._id, String(medication._id), { name: 'دواء ب' }, now);
        expect(result.schedule_version).toBe(1);
        expect(await MedicationDose.countDocuments({ medication_id: medication._id, status: 'PENDING', 'medication_snapshot.name': 'دواء ب' })).toBeGreaterThan(0);
    });

    test('archive cancels future doses and inbox reminders while preserving records', async () => {
        const medication = await patientMedicationService.create(patientA._id, input(), now);
        await patientMedicationService.archive(patientA._id, String(medication._id), now);
        expect(await PatientMedication.countDocuments({ _id: medication._id, status: 'archived', reminders_enabled: false })).toBe(1);
        expect(await MedicationDose.countDocuments({ medication_id: medication._id, status: 'PENDING' })).toBe(0);
        expect(await Notification.countDocuments({ 'source.id': medication._id, visible_at: { $gt: now }, status: { $ne: 'cancelled' } })).toBe(0);
        expect(await MedicationDose.countDocuments({ medication_id: medication._id })).toBeGreaterThan(0);
    });

    test('ownership hides foreign medications and doses', async () => {
        const medication = await patientMedicationService.create(patientB._id, input(), now);
        await expect(patientMedicationService.get(patientA._id, String(medication._id), now)).rejects.toMatchObject({ status: 404 });
        await expect(patientMedicationService.update(patientA._id, String(medication._id), { name: 'x' }, now)).rejects.toMatchObject({ status: 404 });
        await expect(patientMedicationService.archive(patientA._id, String(medication._id), now)).rejects.toMatchObject({ status: 404 });
        const dose = await MedicationDose.findOne({ medication_id: medication._id });
        await expect(medicationDoseService.record(patientA._id, String(dose!._id), MedicationDoseStatusEnum.TAKEN, now)).rejects.toMatchObject({ status: 404 });
        await expect(medicationDoseService.record(patientA._id, String(dose!._id), MedicationDoseStatusEnum.NOT_TAKEN, now)).rejects.toMatchObject({ status: 404 });
    });

    test('taken/not-taken are idempotent and opposite final transitions conflict', async () => {
        const medication = await patientMedicationService.create(patientA._id, input(), now);
        const doses = await MedicationDose.find({ medication_id: medication._id }).sort({ scheduled_at: 1 });
        const taken = await medicationDoseService.record(patientA._id, String(doses[0]!._id), MedicationDoseStatusEnum.TAKEN, now);
        const duplicate = await medicationDoseService.record(patientA._id, String(doses[0]!._id), MedicationDoseStatusEnum.TAKEN, new Date(now.getTime() + 1000));
        expect(duplicate.taken_at).toEqual(taken.taken_at);
        await expect(medicationDoseService.record(patientA._id, String(doses[0]!._id), MedicationDoseStatusEnum.NOT_TAKEN, now)).rejects.toMatchObject({ status: 409 });
        expect((await medicationDoseService.record(patientA._id, String(doses[1]!._id), MedicationDoseStatusEnum.NOT_TAKEN, now)).status).toBe('NOT_TAKEN');
    });

    test('today query is Baghdad-bounded and sync exposes current versions only', async () => {
        const medication = await patientMedicationService.create(patientA._id, input(), now);
        await MedicationDose.create({ medication_id: medication._id, patient_id: patientA._id, schedule_version: 1, scheduled_at: new Date('2026-09-07T05:00:00Z'), medication_snapshot: { name: 'past' }, status: 'PENDING' });
        const today = await medicationDoseService.today(patientA._id, now);
        expect(today.some(d => new Date(d.scheduled_at).toISOString() === '2026-09-07T05:00:00.000Z')).toBe(true);
        const sync = await medicationDoseService.upcoming(patientA._id, now);
        expect(sync.schedules).toContainEqual({ medication_id: String(medication._id), schedule_version: 1, timezone: 'Asia/Baghdad' });
        expect(sync.reminders.every(r => r.schedule_version === 1 && new Date(r.scheduled_at) > now)).toBe(true);
    });

    test('disabled reminders and expired end dates generate no doses', async () => {
        const disabled = await patientMedicationService.create(patientA._id, input({ reminders_enabled: false }), now);
        const expired = await patientMedicationService.create(patientA._id, input({ name: 'expired', schedule: { timezone: 'Asia/Baghdad', weekdays: [0,1,2,3,4,5,6], times: ['08:00'], start_date: '2026-09-01', end_date: '2026-09-06' } }), now);
        expect(await MedicationDose.countDocuments({ medication_id: { $in: [disabled._id, expired._id] } })).toBe(0);
    });
});
