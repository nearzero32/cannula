import { afterAll, beforeAll, describe, expect, mock, spyOn, test } from 'bun:test';
import mongoose from 'mongoose';
import Appointment from '../src/models/appointments.model';
import notificationService from '../src/services/notification.service';
import appointmentDomainEventService from '../src/services/appointment-domain-event.service';
import { registerAppointmentNotificationHandler } from '../src/services/appointment-notification.service';

describe('Appointment post-commit notification handler', () => {
    const appointmentId = new mongoose.Types.ObjectId(), patientId = new mongoose.Types.ObjectId(), doctorId = new mongoose.Types.ObjectId();
    let createOnce: ReturnType<typeof spyOn>;
    beforeAll(() => registerAppointmentNotificationHandler());
    afterAll(() => mock.restore());

    function arrange() {
        spyOn(Appointment, 'findById').mockReturnValue({ select() { return this; }, lean() { return this; }, exec: async () => ({ _id: appointmentId, patient_id: patientId, doctor_id: doctorId, starts_at: new Date('2026-09-10T06:00:00Z'), local_date: '2026-09-10', snapshot: { doctor: { display_name: 'د. أحمد' } }, workflow_version: 1 }) } as never);
        createOnce = spyOn(notificationService, 'createOnce').mockResolvedValue({ notification: { _id: new mongoose.Types.ObjectId() }, created: false } as never);
    }

    test('created notifies patient and doctor with distinct dedupe keys', async () => {
        arrange();
        await appointmentDomainEventService.publish({ type: 'APPOINTMENT_CREATED', appointmentId: String(appointmentId), occurredAt: new Date().toISOString(), data: { actorType: 'PATIENT' } });
        expect(createOnce).toHaveBeenCalledTimes(2);
        expect(createOnce.mock.calls.map((call: any[]) => call[1])).toEqual(expect.arrayContaining([
            expect.stringContaining(':appointment_booked:Patient:'), expect.stringContaining(':appointment_booked:Doctor:'),
        ]));
        mock.restore();
    });

    test('patient cancellation notifies only the doctor', async () => {
        arrange();
        await appointmentDomainEventService.publish({ type: 'APPOINTMENT_CANCELLED', appointmentId: String(appointmentId), occurredAt: new Date().toISOString(), data: { actorType: 'PATIENT' } });
        expect(createOnce).toHaveBeenCalledTimes(1);
        expect(createOnce.mock.calls[0][0]).toMatchObject({ recipient_model: 'Doctor', recipient_ids: [doctorId] });
        mock.restore();
    });
});
