import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import mongoose from 'mongoose';
import Appointment from '../src/models/appointments.model';
import AppointmentHistory from '../src/models/appointment-history.model';
import Doctor from '../src/models/doctors.model';
import ActivityLogService from '../src/services/activity-log.service';
import appointmentService from '../src/services/appointment.service';
import { AppointmentWorkflowService } from '../src/services/appointment-workflow.service';
import { directAppointmentTransactionRunner } from '../src/services/appointment-transaction.service';
import { AppointmentActorTypeEnum, IAppointmentStatusEnum } from '../src/interfaces/appointment.interface';

afterEach(() => mock.restore());
const query = <T>(value: T) => ({ session() { return this; }, exec: async () => value });

describe('Appointment ownership and patient policies', () => {
    const appointmentId = new mongoose.Types.ObjectId(), patientId = new mongoose.Types.ObjectId(), otherPatientId = new mongoose.Types.ObjectId();
    const doctorId = new mongoose.Types.ObjectId(), otherDoctorId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    const current = (overrides: any = {}) => ({ _id: appointmentId, appointment_number: 'APP-2026-000001', patient_id: patientId, doctor_id: doctorId, clinic_id: new mongoose.Types.ObjectId(), status: IAppointmentStatusEnum.CONFIRMED, workflow_version: 0, starts_at: new Date('2026-09-10T12:00:00Z'), ...overrides });
    const noNotifications = { append: async () => undefined, scheduleForConfirmedAppointment: async () => undefined, cancelFutureForAppointment: async () => undefined };
    const workflow = () => new AppointmentWorkflowService(directAppointmentTransactionRunner, { requireSlot: async () => { throw new Error('must not reach slots'); } } as any, noNotifications);

    test('Patient foreign appointment is hidden as not owned', async () => {
        spyOn(Appointment, 'findById').mockReturnValue(query(current()) as never);
        await expect(workflow().cancel(String(appointmentId), { type: AppointmentActorTypeEnum.PATIENT, patientId: String(otherPatientId), userId: String(userId) })).rejects.toMatchObject({ status: 404, code: 'APPOINTMENT_NOT_OWNED' });
    });

    test('Doctor cannot operate another doctor appointment', async () => {
        spyOn(Appointment, 'findById').mockReturnValue(query(current()) as never);
        await expect(workflow().checkIn(String(appointmentId), { type: AppointmentActorTypeEnum.DOCTOR, doctorId: String(otherDoctorId), userId: String(userId) })).rejects.toMatchObject({ status: 403, code: 'APPOINTMENT_NOT_OWNED' });
    });

    test('Patient cancellation obeys the doctor cancellation window', async () => {
        spyOn(Appointment, 'findById').mockReturnValue(query(current()) as never);
        spyOn(Doctor, 'findById').mockReturnValue(query({ cancellation_window_hours: 24 }) as never);
        await expect(workflow().cancel(String(appointmentId), { type: AppointmentActorTypeEnum.PATIENT, patientId: String(patientId), userId: String(userId) }, null, new Date('2026-09-10T00:01:00Z'))).rejects.toMatchObject({ status: 409, code: 'APPOINTMENT_CANCELLATION_WINDOW_CLOSED' });
    });

    test.each([
        [AppointmentActorTypeEnum.PATIENT, { type: AppointmentActorTypeEnum.PATIENT, patientId: String(patientId), userId: String(userId) }],
        [AppointmentActorTypeEnum.ADMIN, { type: AppointmentActorTypeEnum.ADMIN, userId: String(userId) }],
    ] as const)('%s cancellation persists complete validated metadata', async (actorType, actor) => {
        const at = new Date('2026-09-01T00:00:00.000Z');
        const existing = current();
        let writtenCancellation: any;
        spyOn(Appointment, 'findById').mockReturnValue(query(existing) as never);
        spyOn(Doctor, 'findById').mockReturnValue(query({ cancellation_window_hours: 24 }) as never);
        spyOn(Appointment, 'findOneAndUpdate').mockImplementation(((_filter: any, update: any, options: any) => {
            expect(options).toMatchObject({ returnDocument: 'after', runValidators: true });
            writtenCancellation = update.$set.cancellation;
            return query({ ...existing, status: IAppointmentStatusEnum.CANCELLED, cancellation: writtenCancellation, workflow_version: 1 }) as never;
        }) as any);
        spyOn(AppointmentHistory, 'create').mockResolvedValue({} as never);
        spyOn(ActivityLogService, 'logActivity').mockResolvedValue({} as never);

        const result = await workflow().cancel(String(appointmentId), actor, ' سبب الإلغاء ', at);

        expect(writtenCancellation).toEqual({ reason: 'سبب الإلغاء', actor_type: actorType, actor_user_id: userId, at });
        expect(result.cancellation).toEqual(writtenCancellation);
    });

    test('terminal appointments cannot be cancelled', async () => {
        spyOn(Appointment, 'findById').mockReturnValue(query(current({ status: IAppointmentStatusEnum.COMPLETED })) as never);
        await expect(workflow().cancel(String(appointmentId), { type: AppointmentActorTypeEnum.ADMIN, userId: String(userId) })).rejects.toMatchObject({ status: 409, code: 'APPOINTMENT_INVALID_TRANSITION' });
    });

    test('Patient reschedule requires doctor allow_reschedule', async () => {
        spyOn(Appointment, 'findById').mockReturnValue(query(current()) as never);
        spyOn(Doctor, 'findById').mockReturnValue(query({ allow_reschedule: false, cancellation_window_hours: 0 }) as never);
        await expect(workflow().reschedule(String(appointmentId), { date: '2026-09-11', startsAt: '2026-09-11T06:00:00.000Z' }, { type: AppointmentActorTypeEnum.PATIENT, patientId: String(patientId), userId: String(userId) })).rejects.toMatchObject({ status: 409, code: 'APPOINTMENT_RESCHEDULE_NOT_ALLOWED' });
    });

    test('patient detail lookup is one patient-scoped query', async () => {
        const findOne = spyOn(Appointment, 'findOne').mockReturnValue({ exec: async () => null } as never);
        await expect(appointmentService.patientAppointment(String(appointmentId), String(patientId))).rejects.toMatchObject({ status: 404, code: 'APPOINTMENT_NOT_OWNED' });
        expect(findOne).toHaveBeenCalledWith({ _id: appointmentId, patient_id: patientId });
    });

    test('patient upcoming list always includes patient id and current-time bound', async () => {
        let filter: any;
        spyOn(Appointment, 'find').mockImplementation(((value: any) => { filter = value; return { sort() { return this; }, skip() { return this; }, limit() { return this; }, exec: async () => [] } as never; }) as any);
        spyOn(Appointment, 'countDocuments').mockReturnValue({ exec: async () => 0 } as never);
        await appointmentService.list({ patientId: String(patientId), view: 'upcoming' });
        expect(filter.patient_id).toEqual(patientId);
        expect(filter.starts_at.$gte).toBeInstanceOf(Date);
    });
});
