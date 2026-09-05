import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import mongoose from 'mongoose';
import Patient from '../src/models/patients.model';
import Doctor from '../src/models/doctors.model';
import domainNotificationService from '../src/services/domain-notification.service';
import appointmentDomainEventService from '../src/services/appointment-domain-event.service';
import { appendAppointmentNotification, registerAppointmentNotificationHandler } from '../src/services/appointment-notification.service';

function query(value: unknown, sessionSeen: { value?: unknown }) {
    return { select() { return this; }, session(session: unknown) { sessionSeen.value = session; return this; }, lean() { return this; }, exec: async () => value };
}

describe('Appointment transactional notification architecture', () => {
    afterEach(() => mock.restore());

    test('created resolves canonical users and forwards the supplied session', async () => {
        const patientId = new mongoose.Types.ObjectId(), doctorId = new mongoose.Types.ObjectId();
        const patientUser = new mongoose.Types.ObjectId(), doctorUser = new mongoose.Types.ObjectId();
        const session = { id: 'same-session' } as any;
        const patientSession: { value?: unknown } = {}, doctorSession: { value?: unknown } = {};
        spyOn(Patient, 'findById').mockReturnValue(query({ user_id: patientUser }, patientSession) as never);
        spyOn(Doctor, 'findById').mockReturnValue(query({ user_id: doctorUser }, doctorSession) as never);
        const targeted = spyOn(domainNotificationService, 'targeted').mockResolvedValue({} as never);
        await appendAppointmentNotification({ _id: new mongoose.Types.ObjectId(), patient_id: patientId, doctor_id: doctorId, starts_at: new Date('2026-09-10T06:00:00Z'), snapshot: { doctor: { display_name: 'أحمد' } }, workflow_version: 2 }, 'CREATED', 'PATIENT', session);
        expect(patientSession.value).toBe(session); expect(doctorSession.value).toBe(session);
        expect(targeted.mock.calls.map((call: any[]) => String(call[0].userIds[0])).sort()).toEqual([String(patientUser), String(doctorUser)].sort());
        expect(targeted.mock.calls.every((call: any[]) => call[0].session === session)).toBe(true);
    });

    test('patient cancellation targets only canonical Doctor user', async () => {
        const patientUser = new mongoose.Types.ObjectId(), doctorUser = new mongoose.Types.ObjectId();
        spyOn(Patient, 'findById').mockReturnValue(query({ user_id: patientUser }, {}) as never);
        spyOn(Doctor, 'findById').mockReturnValue(query({ user_id: doctorUser }, {}) as never);
        const targeted = spyOn(domainNotificationService, 'targeted').mockResolvedValue({} as never);
        await appendAppointmentNotification({ _id: new mongoose.Types.ObjectId(), patient_id: new mongoose.Types.ObjectId(), doctor_id: new mongoose.Types.ObjectId(), starts_at: new Date(), snapshot: { doctor: { display_name: 'أحمد' } }, workflow_version: 3 }, 'CANCELLED', 'PATIENT', {} as any);
        expect(targeted).toHaveBeenCalledTimes(1); expect(String(targeted.mock.calls[0][0].userIds[0])).toBe(String(doctorUser));
    });

    test('legacy registration is inert and workflow statically owns reminder lifecycle', async () => {
        const subscribe = spyOn(appointmentDomainEventService, 'subscribe'); registerAppointmentNotificationHandler(); expect(subscribe).not.toHaveBeenCalled();
        const workflow = await Bun.file(new URL('../src/services/appointment-workflow.service.ts', import.meta.url)).text();
        const reminder = await Bun.file(new URL('../src/services/appointment-reminder.service.ts', import.meta.url)).text();
        for (const token of ['scheduleForConfirmedAppointment', 'cancelFutureForAppointment']) expect(workflow).toContain(token);
        expect(workflow).toContain("if(action==='confirm')await appointmentReminderService.scheduleForConfirmedAppointment(updated,session,now)");
        expect(workflow).toContain("if(action==='complete'||action==='noShow')await appointmentReminderService.cancelFutureForAppointment(updated._id,session)");
        expect(workflow).toContain("await appointmentReminderService.cancelFutureForAppointment(updated._id,session)");
        expect(workflow).toContain('this.createInTransaction(booking, actor, session, now, String(current._id), true)');
        expect(workflow).toContain('await appointmentReminderService.cancelFutureForAppointment(updated._id, session)');
        expect(workflow).toContain('if(status===IAppointmentStatusEnum.CONFIRMED)await appointmentReminderService.scheduleForConfirmedAppointment(appointment,session,now)');
        expect(workflow).not.toContain('appointmentDomainEventService.publish');
        expect(reminder).toContain('APPOINTMENT_REMINDER');
        expect(reminder).not.toMatch(/OneSignal|notificationService\.dispatch|createAndDispatch|sendPush|node-schedule/);
        expect(reminder).not.toContain('DURABLE_APPOINTMENT_REMINDERS_PENDING');
    });
});
