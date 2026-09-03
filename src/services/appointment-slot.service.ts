import type { ClientSession } from 'mongoose';
import mongoose from 'mongoose';
import Doctor from '../models/doctors.model';
import Clinic from '../models/clinics.model';
import Specialty from '../models/specialties.model';
import DoctorAvailability from '../models/doctor-availability.model';
import DoctorAvailabilityException from '../models/doctor-availability-exception.model';
import Appointment, { APPOINTMENT_BLOCKING_STATUSES } from '../models/appointments.model';
import { DEFAULT_MAX_APPOINTMENTS_PER_DAY, IDoctorStatusEnum, IDoctorVerificationStatusEnum } from '../interfaces/doctor.interface';
import { IClinicStatusEnum } from '../interfaces/clinic.interface';
import { ISpecialtyStatusEnum } from '../interfaces/specialty.interface';
import { AvailabilityExceptionTypeEnum, type AvailabilityPeriod } from '../interfaces/doctor-availability.interface';
import { APPOINTMENT_DAILY_CAP_COUNTING_STATUSES, APPOINTMENT_TIMEZONE, AppointmentAvailabilityStatusEnum, DEFAULT_NEXT_AVAILABILITY_OPTIONS, DEFAULT_NEXT_AVAILABILITY_SEARCH_DAYS, MAX_NEXT_AVAILABILITY_SEARCH_DAYS } from '../interfaces/appointment.interface';
import { addMinutes, assertLocalDate, localDateRangeUtc, localDateTimeToUtc, localDayOfWeek, minutesToTime, nextLocalDate, timeToMinutes, toBaghdadLocal } from './appointment-time.service';
import { DomainError } from './domain-error';

const oid = (value: string, code = 'APPOINTMENT_INVALID') => {
    if (!mongoose.Types.ObjectId.isValid(value)) throw new DomainError('المعرف غير صالح', 400, code);
    return new mongoose.Types.ObjectId(value);
};
const inSession = <T extends { session(session: ClientSession): T }>(query: T, session?: ClientSession | null) => session ? query.session(session) : query;
const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) => aStart < bEnd && aEnd > bStart;

export interface AppointmentSlot {
    startsAt: string; endsAt: string; localStartsAt: string; localEndsAt: string;
    blockedStartsAt: string; blockedEndsAt: string;
}
export interface SlotQuery { doctorId: string; clinicId: string; date: string; specialtyId?: string | null }
export interface SlotOptions { session?: ClientSession | null; now?: Date; enforceLeadTime?: boolean; excludeAppointmentId?: string | null }
export interface AvailabilityOptions extends SlotOptions { includeSuggestions?: boolean; searchDays?: number; maxOptions?: number }
export interface SlotGenerationInput {
    date: string; periods: AvailabilityPeriod[]; duration: number; interval: number; before: number; after: number;
    leadMinutes: number; now: Date; existing: Array<{ blocked_starts_at: Date; blocked_ends_at: Date }>;
}

/** Pure slot calculation kept separate from database loading for deterministic testing. */
export function generateAppointmentSlots(input: SlotGenerationInput): AppointmentSlot[] {
    const slots: AppointmentSlot[] = [];
    for (const period of input.periods) {
        const periodStart = timeToMinutes(period.start_time), periodEnd = timeToMinutes(period.end_time);
        for (let startMinute = periodStart; startMinute + input.duration <= periodEnd; startMinute += input.interval) {
            if (startMinute - input.before < periodStart || startMinute + input.duration + input.after > periodEnd) continue;
            const startsAt = localDateTimeToUtc(input.date, minutesToTime(startMinute)), endsAt = addMinutes(startsAt, input.duration);
            const blockedStartsAt = addMinutes(startsAt, -input.before), blockedEndsAt = addMinutes(endsAt, input.after);
            if (startsAt.getTime() < input.now.getTime() + input.leadMinutes * 60_000) continue;
            if (input.existing.some(item => overlaps(blockedStartsAt, blockedEndsAt, item.blocked_starts_at, item.blocked_ends_at))) continue;
            slots.push({ startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), localStartsAt: toBaghdadLocal(startsAt).time, localEndsAt: toBaghdadLocal(endsAt).time, blockedStartsAt: blockedStartsAt.toISOString(), blockedEndsAt: blockedEndsAt.toISOString() });
        }
    }
    return slots;
}

export class AppointmentSlotService {
    async context(input: SlotQuery, options: SlotOptions = {}) {
        const doctorId = oid(input.doctorId, 'DOCTOR_NOT_BOOKABLE'), clinicId = oid(input.clinicId, 'DOCTOR_NOT_AT_CLINIC');
        const [doctor, clinic] = await Promise.all([
            inSession(Doctor.findById(doctorId), options.session).exec(),
            inSession(Clinic.findById(clinicId), options.session).exec(),
        ]);
        if (!doctor || doctor.status !== IDoctorStatusEnum.ACTIVE || doctor.verification_status !== IDoctorVerificationStatusEnum.VERIFIED || !doctor.license_verified || !doctor.accepting_new_patients) throw new DomainError('الطبيب غير متاح للحجز', 422, 'DOCTOR_NOT_BOOKABLE');
        if (!clinic || clinic.status !== IClinicStatusEnum.ACTIVE) throw new DomainError('العيادة غير متاحة للحجز', 422, 'DOCTOR_NOT_AT_CLINIC');
        if (!doctor.clinic_ids.some(value => String(value) === input.clinicId)) throw new DomainError('الطبيب غير مرتبط بهذه العيادة', 422, 'DOCTOR_NOT_AT_CLINIC');
        let specialty: any = null;
        if (input.specialtyId) {
            specialty = await inSession(Specialty.findById(oid(input.specialtyId, 'SPECIALTY_INVALID')), options.session).exec();
            const assigned = (doctor.specialty_ids ?? []).some(value => String(value) === input.specialtyId);
            if (!specialty || specialty.status !== ISpecialtyStatusEnum.ACTIVE || !assigned) throw new DomainError('التخصص غير متاح لهذا الطبيب', 422, 'SPECIALTY_INVALID');
        }
        return { doctor, clinic, specialty };
    }
    async getSlots(input: SlotQuery, options: SlotOptions = {}) {
        const date = assertLocalDate(input.date), now = options.now ?? new Date();
        const context = await this.context(input, options);
        const doctorObjectId = oid(input.doctorId), clinicObjectId = oid(input.clinicId);
        const dayRange = localDateRangeUtc(date);
        const excludeId = options.excludeAppointmentId ? oid(options.excludeAppointmentId) : null;
        const capFilter: Record<string, unknown> = { doctor_id: doctorObjectId, local_date: date, status: { $in: APPOINTMENT_DAILY_CAP_COUNTING_STATUSES } };
        if (excludeId) capFilter._id = { $ne: excludeId };
        const booked = await inSession(Appointment.countDocuments(capFilter), options.session).exec();
        const max = context.doctor.max_appointments_per_day ?? DEFAULT_MAX_APPOINTMENTS_PER_DAY;
        const remaining = Math.max(0, max - booked);
        const baseCapacity = { max, booked, remaining, reached: booked >= max };
        if (baseCapacity.reached) return { doctorId: input.doctorId, clinicId: input.clinicId, date, timezone: APPOINTMENT_TIMEZONE, availabilityStatus: AppointmentAvailabilityStatusEnum.DAILY_CAP_REACHED, dailyCapacity: { ...baseCapacity, availableSlotCount: 0, bookableRemaining: 0 }, slots: [] as AppointmentSlot[], context };
        const blockingFilter: Record<string, unknown> = { doctor_id: doctorObjectId, status: { $in: APPOINTMENT_BLOCKING_STATUSES }, blocked_starts_at: { $lt: dayRange.end }, blocked_ends_at: { $gt: dayRange.start } };
        if (excludeId) blockingFilter._id = { $ne: excludeId };
        const [weekly, exceptions] = await Promise.all([
            inSession(DoctorAvailability.findOne({ doctor_id: doctorObjectId, clinic_id: clinicObjectId, day_of_week: localDayOfWeek(date), is_active: true }), options.session).exec(),
            inSession(DoctorAvailabilityException.find({ doctor_id: doctorObjectId, local_date: date, $or: [{ clinic_id: clinicObjectId }, { clinic_id: null }] }), options.session).exec(),
        ]);
        const exception = exceptions.find(item => String(item.clinic_id) === input.clinicId) ?? exceptions.find(item => !item.clinic_id);
        let periods: AvailabilityPeriod[] = weekly?.periods?.map(period => ({ start_time: period.start_time, end_time: period.end_time })) ?? [];
        const explicitlyClosed = exception?.type === AvailabilityExceptionTypeEnum.CLOSED;
        if (explicitlyClosed) periods = [];
        if (exception?.type === AvailabilityExceptionTypeEnum.CUSTOM_HOURS) periods = exception.periods.map(period => ({ start_time: period.start_time, end_time: period.end_time }));
        const duration = context.doctor.appointment_duration, interval = context.doctor.slot_interval;
        const before = context.doctor.buffer_before, after = context.doctor.buffer_after;
        const leadMinutes = (options.enforceLeadTime ?? true) ? context.doctor.booking_lead_time_hours * 60 : 0;
        if (!periods.length) {
            const status = explicitlyClosed ? AppointmentAvailabilityStatusEnum.DOCTOR_CLOSED : AppointmentAvailabilityStatusEnum.NO_WORKING_HOURS;
            return { doctorId: input.doctorId, clinicId: input.clinicId, date, timezone: APPOINTMENT_TIMEZONE, availabilityStatus: status, dailyCapacity: { ...baseCapacity, availableSlotCount: 0, bookableRemaining: 0 }, slots: [] as AppointmentSlot[], context };
        }
        const theoretical = generateAppointmentSlots({ date, periods, duration, interval, before, after, leadMinutes: 0, now: new Date(0), existing: [] });
        if (!theoretical.length) return { doctorId: input.doctorId, clinicId: input.clinicId, date, timezone: APPOINTMENT_TIMEZONE, availabilityStatus: AppointmentAvailabilityStatusEnum.NO_VALID_SLOT, dailyCapacity: { ...baseCapacity, availableSlotCount: 0, bookableRemaining: 0 }, slots: [] as AppointmentSlot[], context };
        const existing = await inSession(Appointment.find(blockingFilter).select('blocked_starts_at blocked_ends_at'), options.session).exec();
        const occupied = generateAppointmentSlots({ date, periods, duration, interval, before, after, leadMinutes: 0, now: new Date(0), existing });
        const slots = generateAppointmentSlots({ date, periods, duration, interval, before, after, leadMinutes, now, existing });
        const availabilityStatus = slots.length ? AppointmentAvailabilityStatusEnum.AVAILABLE : occupied.length ? AppointmentAvailabilityStatusEnum.NO_VALID_SLOT : AppointmentAvailabilityStatusEnum.FULLY_BOOKED;
        return { doctorId: input.doctorId, clinicId: input.clinicId, date, timezone: APPOINTMENT_TIMEZONE, availabilityStatus, dailyCapacity: { ...baseCapacity, availableSlotCount: slots.length, bookableRemaining: Math.min(remaining, slots.length) }, slots, context };
    }
    async getAvailability(input: SlotQuery, options: AvailabilityOptions = {}) {
        const result = await this.getSlots(input, options);
        const publicSlots = result.slots.map(this.publicSlot);
        const nextAvailableOptions: Array<ReturnType<AppointmentSlotService['option']>> = [];
        if ((options.includeSuggestions ?? true) && !publicSlots.length) {
            const days = Math.min(MAX_NEXT_AVAILABILITY_SEARCH_DAYS, Math.max(1, options.searchDays ?? DEFAULT_NEXT_AVAILABILITY_SEARCH_DAYS));
            const maxOptions = Math.max(1, Math.min(10, options.maxOptions ?? DEFAULT_NEXT_AVAILABILITY_OPTIONS));
            let date = result.date;
            for (let offset = 0; offset < days && nextAvailableOptions.length < maxOptions; offset++) {
                date = nextLocalDate(date);
                const candidate = await this.getSlots({ ...input, date }, { ...options, excludeAppointmentId: null });
                for (const slot of candidate.slots) {
                    nextAvailableOptions.push(this.option(date, slot));
                    if (nextAvailableOptions.length >= maxOptions) break;
                }
            }
        }
        return { ...result, slots: publicSlots, nextAvailable: nextAvailableOptions[0] ?? null, nextAvailableOptions, ...(!publicSlots.length && !nextAvailableOptions.length ? { nextAvailabilityStatus: AppointmentAvailabilityStatusEnum.NO_UPCOMING_AVAILABILITY } : {}) };
    }
    private publicSlot(slot: AppointmentSlot) { return { startsAt: slot.startsAt, endsAt: slot.endsAt, localStartsAt: slot.localStartsAt, localEndsAt: slot.localEndsAt }; }
    private option(date: string, slot: AppointmentSlot) { return { date, ...this.publicSlot(slot) }; }
    async requireSlot(input: SlotQuery & { startsAt: string }, options: SlotOptions = {}) {
        const instant = new Date(input.startsAt);
        if (Number.isNaN(instant.getTime()) || toBaghdadLocal(instant).date !== assertLocalDate(input.date)) throw new DomainError('وقت الموعد غير صالح', 400, 'APPOINTMENT_TIME_INVALID');
        const result = await this.getSlots(input, options);
        const leadMinutes = (options.enforceLeadTime ?? true) ? result.context.doctor.booking_lead_time_hours * 60 : 0;
        if (instant.getTime() < (options.now ?? new Date()).getTime() + leadMinutes * 60_000) throw new DomainError('الموعد أقرب من مهلة الحجز المسموحة', 409, 'APPOINTMENT_TOO_SOON');
        const slot = result.slots.find(candidate => candidate.startsAt === instant.toISOString());
        if (!slot && result.availabilityStatus === AppointmentAvailabilityStatusEnum.DAILY_CAP_REACHED) throw new DomainError('اكتمل الحد الأقصى لحجوزات الطبيب لهذا اليوم', 409, 'APPOINTMENT_DAILY_CAP_REACHED');
        if (!slot) throw new DomainError('الموعد المختار غير متاح', 409, 'APPOINTMENT_SLOT_UNAVAILABLE');
        return { ...result, slot };
    }
}
export default new AppointmentSlotService();
