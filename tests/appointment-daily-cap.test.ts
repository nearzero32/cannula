import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import mongoose from 'mongoose';
import Doctor from '../src/models/doctors.model';
import Clinic from '../src/models/clinics.model';
import Appointment from '../src/models/appointments.model';
import { AppointmentSlotService } from '../src/services/appointment-slot.service';
import { APPOINTMENT_DAILY_CAP_COUNTING_STATUSES, AppointmentAvailabilityStatusEnum, IAppointmentStatusEnum } from '../src/interfaces/appointment.interface';
import { DEFAULT_MAX_APPOINTMENTS_PER_DAY } from '../src/interfaces/doctor.interface';

afterEach(() => mock.restore());
const query = <T>(value: T) => ({ exec: async () => value, session() { return this; } });

describe('Appointment daily cap policy', () => {
    test('default is 30 and the exact six consuming statuses exclude cancelled/rescheduled', () => {
        expect(DEFAULT_MAX_APPOINTMENTS_PER_DAY).toBe(30);
        expect(APPOINTMENT_DAILY_CAP_COUNTING_STATUSES).toEqual([
            IAppointmentStatusEnum.PENDING, IAppointmentStatusEnum.CONFIRMED, IAppointmentStatusEnum.CHECKED_IN,
            IAppointmentStatusEnum.IN_PROGRESS, IAppointmentStatusEnum.COMPLETED, IAppointmentStatusEnum.NO_SHOW,
        ]);
        expect(APPOINTMENT_DAILY_CAP_COUNTING_STATUSES).not.toContain(IAppointmentStatusEnum.CANCELLED);
        expect(APPOINTMENT_DAILY_CAP_COUNTING_STATUSES).not.toContain(IAppointmentStatusEnum.RESCHEDULED);
    });

    test('cap-reached availability short-circuits schedule queries and is global across clinics', async () => {
        const doctorId = new mongoose.Types.ObjectId(), clinicId = new mongoose.Types.ObjectId(), specialtyId = new mongoose.Types.ObjectId();
        spyOn(Doctor, 'findById').mockReturnValue(query({ _id: doctorId, status: 'active', verification_status: 'verified', license_verified: true, accepting_new_patients: true, clinic_ids: [clinicId], specialty_ids: [specialtyId], max_appointments_per_day: 5 }) as never);
        spyOn(Clinic, 'findById').mockReturnValue(query({ _id: clinicId, status: 'active' }) as never);
        const count = spyOn(Appointment, 'countDocuments').mockReturnValue(query(5) as never);
        const result = await new AppointmentSlotService().getSlots({ doctorId: String(doctorId), clinicId: String(clinicId), date: '2026-09-10' });
        expect(result.availabilityStatus).toBe(AppointmentAvailabilityStatusEnum.DAILY_CAP_REACHED);
        expect(result.dailyCapacity).toEqual({ max: 5, booked: 5, remaining: 0, reached: true, availableSlotCount: 0, bookableRemaining: 0 });
        expect(result.slots).toEqual([]);
        const filter = count.mock.calls[0][0] as Record<string, unknown>;
        expect(filter).not.toHaveProperty('clinic_id');
    });

    test('next availability search is bounded and returns at most three nearest slots', async () => {
        const service = new AppointmentSlotService();
        const empty = (date: string) => ({ doctorId: 'd', clinicId: 'c', date, timezone: 'Asia/Baghdad', availabilityStatus: AppointmentAvailabilityStatusEnum.FULLY_BOOKED, dailyCapacity: { max: 30, booked: 1, remaining: 29, reached: false, availableSlotCount: 0, bookableRemaining: 0 }, slots: [], context: {} });
        let calls = 0;
        spyOn(service, 'getSlots').mockImplementation(async input => {
            calls++;
            if (input.date < '2026-09-12') return empty(input.date) as never;
            return { ...empty(input.date), availabilityStatus: AppointmentAvailabilityStatusEnum.AVAILABLE, slots: [{ startsAt: `${input.date}T06:00:00.000Z`, endsAt: `${input.date}T06:30:00.000Z`, localStartsAt: '09:00', localEndsAt: '09:30', blockedStartsAt: `${input.date}T06:00:00.000Z`, blockedEndsAt: `${input.date}T06:30:00.000Z` }] } as never;
        });
        const result = await service.getAvailability({ doctorId: 'd', clinicId: 'c', date: '2026-09-10' }, { searchDays: 30, maxOptions: 3 });
        expect(result.nextAvailable?.date).toBe('2026-09-12');
        expect(result.nextAvailableOptions).toHaveLength(3);
        expect(calls).toBe(5);
    });

    test('no availability within the bounded horizon has a stable status', async () => {
        const service = new AppointmentSlotService();
        let calls = 0;
        spyOn(service, 'getSlots').mockImplementation(async input => { calls++; return { doctorId: 'd', clinicId: 'c', date: input.date, timezone: 'Asia/Baghdad', availabilityStatus: AppointmentAvailabilityStatusEnum.DOCTOR_CLOSED, dailyCapacity: { max: 30, booked: 0, remaining: 30, reached: false, availableSlotCount: 0, bookableRemaining: 0 }, slots: [], context: {} } as never; });
        const result = await service.getAvailability({ doctorId: 'd', clinicId: 'c', date: '2026-09-10' }, { searchDays: 2 });
        expect(calls).toBe(3);
        expect(result.nextAvailabilityStatus).toBe(AppointmentAvailabilityStatusEnum.NO_UPCOMING_AVAILABILITY);
    });
});
