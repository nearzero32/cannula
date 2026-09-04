import mongoose from 'mongoose';
import Doctor from '../models/doctors.model';
import Clinic from '../models/clinics.model';
import DoctorAvailability from '../models/doctor-availability.model';
import DoctorAvailabilityException from '../models/doctor-availability-exception.model';
import Appointment, { APPOINTMENT_BLOCKING_STATUSES } from '../models/appointments.model';
import { generateAppointmentSlots } from './appointment-slot.service';
import { localDateRangeUtc, localDayOfWeek, toBaghdadLocal } from './appointment-time.service';
import { PATIENT_DOCTOR_SORT, PUBLIC_DOCTOR_MATCH } from './doctor.service';
import { APPOINTMENT_DAILY_CAP_COUNTING_STATUSES, APPOINTMENT_TIMEZONE } from '../interfaces/appointment.interface';
import { AvailabilityExceptionTypeEnum, type AvailabilityPeriod } from '../interfaces/doctor-availability.interface';
import { DEFAULT_MAX_APPOINTMENTS_PER_DAY, IDoctorStatusEnum, IDoctorVerificationStatusEnum } from '../interfaces/doctor.interface';
import { IClinicStatusEnum } from '../interfaces/clinic.interface';

export const AVAILABLE_DOCTORS_CACHE_TTL_SECONDS = 30;

export interface AvailableDoctorsFilters {
    specialty_id?: string;
    clinic_id?: string;
    gender?: string;
    is_featured?: boolean;
}

export interface AvailableDoctorResult {
    doctor: any;
    availability: {
        date: string;
        timezone: typeof APPOINTMENT_TIMEZONE;
        clinicId: string;
        nextSlot: { startsAt: string; endsAt: string; localStartsAt: string; localEndsAt: string };
        availableSlotCount: number;
    };
}

export function availableDoctorsCacheKey(input: AvailableDoctorsFilters & { date: string; page: number; limit: number }) {
    return `cache:mobile:doctors:available:v1:date=${input.date}:page=${input.page}:limit=${input.limit}:specialty=${input.specialty_id ?? 'all'}:clinic=${input.clinic_id ?? 'all'}:gender=${input.gender ?? 'all'}:featured=${input.is_featured ? 'true' : 'all'}`;
}

/** Batched, presentation-only availability discovery. Booking remains authoritative. */
export class AvailableDoctorsService {
    async discover(filters: AvailableDoctorsFilters = {}, now = new Date()): Promise<AvailableDoctorResult[]> {
        const local = toBaghdadLocal(now);
        const doctorMatch: Record<string, unknown> = {
            ...PUBLIC_DOCTOR_MATCH,
            accepting_new_patients: true,
        };
        if (filters.specialty_id) doctorMatch.specialty_ids = new mongoose.Types.ObjectId(filters.specialty_id);
        if (filters.clinic_id) doctorMatch.clinic_ids = new mongoose.Types.ObjectId(filters.clinic_id);
        if (filters.gender) doctorMatch.gender = filters.gender;
        if (filters.is_featured) doctorMatch.is_featured = true;

        // Preserve the canonical database ordering while availability changes membership.
        const doctors = await Doctor.find(doctorMatch).sort(PATIENT_DOCTOR_SORT).lean().exec();
        if (!doctors.length) return [];

        const doctorIds = doctors.map(doctor => doctor._id);
        const doctorIdsByString = new Set(doctorIds.map(String));
        const day = localDayOfWeek(local.date);
        const range = localDateRangeUtc(local.date);
        const [weekly, exceptions, dailyCounts, blocking] = await Promise.all([
            DoctorAvailability.find({ doctor_id: { $in: doctorIds }, day_of_week: day, is_active: true }).lean().exec(),
            DoctorAvailabilityException.find({ doctor_id: { $in: doctorIds }, local_date: local.date }).lean().exec(),
            Appointment.aggregate([
                { $match: { doctor_id: { $in: doctorIds }, local_date: local.date, status: { $in: APPOINTMENT_DAILY_CAP_COUNTING_STATUSES } } },
                { $group: { _id: '$doctor_id', count: { $sum: 1 } } },
            ]).exec(),
            Appointment.find({ doctor_id: { $in: doctorIds }, status: { $in: APPOINTMENT_BLOCKING_STATUSES }, blocked_starts_at: { $lt: range.end }, blocked_ends_at: { $gt: range.start } })
                .select('doctor_id blocked_starts_at blocked_ends_at').lean().exec(),
        ]);

        const clinicIds = new Set<string>();
        for (const doctor of doctors) for (const clinicId of doctor.clinic_ids ?? []) clinicIds.add(String(clinicId));
        for (const row of weekly) clinicIds.add(String(row.clinic_id));
        const clinics = await Clinic.find({ _id: { $in: [...clinicIds].map(id => new mongoose.Types.ObjectId(id)) }, status: IClinicStatusEnum.ACTIVE }).select('_id').lean().exec();
        const activeClinicIds = new Set(clinics.map(clinic => String(clinic._id)));
        const bookedByDoctor = new Map(dailyCounts.map(row => [String(row._id), Number(row.count)]));
        const blockersByDoctor = new Map<string, Array<{ blocked_starts_at: Date; blocked_ends_at: Date }>>();
        for (const appointment of blocking) {
            const id = String(appointment.doctor_id);
            const items = blockersByDoctor.get(id) ?? [];
            items.push({ blocked_starts_at: appointment.blocked_starts_at, blocked_ends_at: appointment.blocked_ends_at });
            blockersByDoctor.set(id, items);
        }
        const schedulesByDoctor = new Map<string, any[]>();
        for (const row of weekly) {
            const id = String(row.doctor_id);
            const rows = schedulesByDoctor.get(id) ?? [];
            rows.push(row);
            schedulesByDoctor.set(id, rows);
        }
        const exceptionsByDoctor = new Map<string, any[]>();
        for (const row of exceptions) {
            const id = String(row.doctor_id);
            const rows = exceptionsByDoctor.get(id) ?? [];
            rows.push(row);
            exceptionsByDoctor.set(id, rows);
        }

        const results: AvailableDoctorResult[] = [];
        for (const doctor of doctors) {
            const doctorId = String(doctor._id);
            if (!doctorIdsByString.has(doctorId)) continue;
            const booked = bookedByDoctor.get(doctorId) ?? 0;
            if (booked >= (doctor.max_appointments_per_day ?? DEFAULT_MAX_APPOINTMENTS_PER_DAY)) continue;
            const assignedClinics = new Set((doctor.clinic_ids ?? []).map(String));
            const slots: Array<{ clinicId: string; slot: ReturnType<typeof generateAppointmentSlots>[number] }> = [];
            for (const schedule of schedulesByDoctor.get(doctorId) ?? []) {
                const clinicId = String(schedule.clinic_id);
                if (!assignedClinics.has(clinicId) || !activeClinicIds.has(clinicId)) continue;
                const exceptionsForDoctor = exceptionsByDoctor.get(doctorId) ?? [];
                const exception = exceptionsForDoctor.find(row => String(row.clinic_id) === clinicId) ?? exceptionsForDoctor.find(row => !row.clinic_id);
                let periods: AvailabilityPeriod[] = schedule.periods ?? [];
                if (exception?.type === AvailabilityExceptionTypeEnum.CLOSED) periods = [];
                if (exception?.type === AvailabilityExceptionTypeEnum.CUSTOM_HOURS) periods = exception.periods ?? [];
                if (!periods.length) continue;
                for (const slot of generateAppointmentSlots({
                    date: local.date,
                    periods,
                    duration: doctor.appointment_duration,
                    interval: doctor.slot_interval,
                    before: doctor.buffer_before,
                    after: doctor.buffer_after,
                    leadMinutes: doctor.booking_lead_time_hours * 60,
                    now,
                    existing: blockersByDoctor.get(doctorId) ?? [],
                })) slots.push({ clinicId, slot });
            }
            const unique = new Map(slots.map(item => [`${item.clinicId}:${item.slot.startsAt}`, item]));
            const available = [...unique.values()].sort((a, b) => a.slot.startsAt.localeCompare(b.slot.startsAt) || a.clinicId.localeCompare(b.clinicId));
            if (!available.length) continue;
            const best = available[0];
            results.push({
                doctor,
                availability: {
                    date: local.date,
                    timezone: APPOINTMENT_TIMEZONE,
                    clinicId: best.clinicId,
                    nextSlot: { startsAt: best.slot.startsAt, endsAt: best.slot.endsAt, localStartsAt: best.slot.localStartsAt, localEndsAt: best.slot.localEndsAt },
                    availableSlotCount: available.length,
                },
            });
        }
        return results;
    }
}

export default new AvailableDoctorsService();
