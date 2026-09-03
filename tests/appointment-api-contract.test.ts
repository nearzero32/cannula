import { describe, expect, test } from 'bun:test';
import { Value } from '@sinclair/typebox/value';
import { mobileAppointmentsController } from '../src/controller/mobile/appointments.controller';
import { doctorAppointmentsController } from '../src/controller/dash/doctor/appointments.controller';
import { appointmentAdminPermission, appointmentsController as adminAppointmentsController } from '../src/controller/dash/admin/appointments.controller';
import { PatientAppointmentCreateBodySchema } from '../src/schemas/appointment-response.schema';
import { formatAppointment } from '../src/services/appointment.service';
import Appointment from '../src/models/appointments.model';

const routes = (controller: any) => controller.routes.map((route: any) => `${route.method} ${route.path}`);

describe('Appointment API contracts and exposure boundaries', () => {
    test('Patient create accepts only an authoritative start and rejects client-controlled end time', () => {
        const valid = { doctorId: '507f191e810c19729de86001', clinicId: '507f191e810c19729de86002', date: '2026-09-10', startsAt: '2026-09-10T06:00:00.000Z', beneficiary: { type: 'SELF' } };
        expect(Value.Check(PatientAppointmentCreateBodySchema, valid)).toBe(true);
        expect(Value.Check(PatientAppointmentCreateBodySchema, { ...valid, endsAt: '2026-09-10T09:00:00.000Z' })).toBe(false);
        expect(Value.Check(PatientAppointmentCreateBodySchema, { ...valid, beneficiary: { type: 'CHILD' } })).toBe(false);
    });

    test('registers the complete Patient lifecycle and no generic mutation route', () => {
        expect(routes(mobileAppointmentsController)).toEqual([
            'GET /appointments/availability', 'GET /appointments/', 'POST /appointments/', 'GET /appointments/:id',
            'GET /appointments/:id/history', 'POST /appointments/:id/cancel', 'POST /appointments/:id/reschedule',
        ]);
        expect(routes(mobileAppointmentsController)).not.toContain('PATCH /appointments/:id');
    });

    test('Doctor surface exposes own schedule/calendar/workflow as explicit operations only', () => {
        const values = routes(doctorAppointmentsController);
        for (const required of ['GET /appointments/availability/weekly/:clinicId', 'PUT /appointments/availability/weekly/:clinicId', 'GET /appointments/availability/preview', 'PATCH /appointments/availability/settings', 'GET /appointments/calendar', 'POST /appointments/:id/confirm', 'POST /appointments/:id/check-in', 'POST /appointments/:id/start', 'POST /appointments/:id/complete', 'POST /appointments/:id/no-show', 'POST /appointments/:id/cancel', 'POST /appointments/:id/reschedule', 'PATCH /appointments/:id/notes']) expect(values).toContain(required);
        expect(values).not.toContain('PATCH /appointments/:id');
    });

    test('Admin surface separates availability, workflow, and payment operations', () => {
        const values = routes(adminAppointmentsController);
        for (const required of ['GET /appointments/availability/:doctorId/weekly/:clinicId', 'PUT /appointments/availability/:doctorId/weekly/:clinicId', 'GET /appointments/calendar', 'POST /appointments/', 'POST /appointments/:id/confirm', 'POST /appointments/:id/cancel', 'POST /appointments/:id/reschedule', 'PATCH /appointments/:id/notes', 'PATCH /appointments/:id/payment']) expect(values).toContain(required);
        expect(values).not.toContain('PATCH /appointments/:id');
        expect(appointmentAdminPermission(new Request('http://localhost/api/dash/admin/appointments/availability/doctor/weekly/clinic'))).toBe('manage_availability');
        expect(appointmentAdminPermission(new Request('http://localhost/api/dash/admin/appointments/id/payment'))).toBe('manage_payments');
        expect(appointmentAdminPermission(new Request('http://localhost/api/dash/admin/appointments/?spoof=/availability/payment'))).toBe('manage_appointments');
    });

    test('Patient DTO uses frozen snapshots and never exposes internal notes', () => {
        const appointment: any = {
            _id: 'a', appointment_number: 'APP-2026-000001', patient_id: 'p', beneficiary_type: 'SELF', child_id: null,
            doctor_id: 'd', clinic_id: 'c', specialty_id: null, starts_at: new Date('2026-09-10T06:00:00Z'), ends_at: new Date('2026-09-10T06:30:00Z'),
            status: 'pending', booking_source: 'app', reason: null, snapshot: { doctor: { display_name: 'الاسم وقت الحجز' }, clinic: { name: 'العيادة وقت الحجز', address: 'العنوان' }, specialty: null, beneficiary: { type: 'SELF', display_name: 'المريض وقت الحجز' }, pricing: { fee: 25000, currency: 'IQD' } },
            payment_status: 'unpaid', rescheduled_from: null, rescheduled_to: null, cancellation: null, notes_internal: 'private', createdAt: new Date(), updatedAt: new Date(),
        };
        const patient = formatAppointment(appointment);
        expect(patient.doctor.display_name).toBe('الاسم وقت الحجز');
        expect(patient.pricing.fee).toBe(25000);
        expect(patient).not.toHaveProperty('notesInternal');
        expect(formatAppointment(appointment, { includeInternal: true }).notesInternal).toBe('private');
    });

    test('Appointment indexes support interval scans and do not preserve the obsolete exact-slot unique index', () => {
        const indexes = Appointment.schema.indexes();
        expect(indexes).toContainEqual([{ appointment_number: 1 }, { unique: true, background: true }]);
        expect(indexes.some(([keys]) => JSON.stringify(keys) === JSON.stringify({ doctor_id: 1, local_date: 1, blocked_starts_at: 1, blocked_ends_at: 1 }))).toBe(true);
        expect(indexes.some(([keys, options]) => (options as any).unique && 'doctor_id' in keys && ('starts_at' in keys || 'date' in keys))).toBe(false);
    });
});
