import mongoose from 'mongoose';
import DoctorAvailability from '../models/doctor-availability.model';
import DoctorAvailabilityException from '../models/doctor-availability-exception.model';
import Doctor from '../models/doctors.model';
import Clinic from '../models/clinics.model';
import { AvailabilityExceptionTypeEnum, type AvailabilityPeriod } from '../interfaces/doctor-availability.interface';
import type { AppointmentActor } from '../interfaces/appointment.interface';
import { IActivityLogActionEnum, IActivityLogSourceEnum } from '../interfaces/activity-log.interface';
import ActivityLogService from './activity-log.service';
import { assertLocalDate, timeToMinutes } from './appointment-time.service';
import { DomainError } from './domain-error';
import { DEFAULT_MAX_APPOINTMENTS_PER_DAY, MAX_MAX_APPOINTMENTS_PER_DAY } from '../interfaces/doctor.interface';

const oid = (value: string, label = 'المعرف') => {
    if (!mongoose.Types.ObjectId.isValid(value)) throw new DomainError(`${label} غير صالح`, 400, 'AVAILABILITY_INVALID');
    return new mongoose.Types.ObjectId(value);
};
export function validateAvailabilityPeriods(periods: AvailabilityPeriod[]): AvailabilityPeriod[] {
    const normalized = periods.map(period => ({ start_time: period.start_time, end_time: period.end_time }))
        .sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time));
    for (let index = 0; index < normalized.length; index++) {
        const current = normalized[index];
        if (timeToMinutes(current.start_time) >= timeToMinutes(current.end_time)) throw new DomainError('بداية فترة الدوام يجب أن تسبق نهايتها', 400, 'AVAILABILITY_INVALID');
        if (index && timeToMinutes(current.start_time) < timeToMinutes(normalized[index - 1].end_time)) throw new DomainError('فترات الدوام متداخلة', 409, 'AVAILABILITY_OVERLAP');
    }
    return normalized;
}
export interface WeeklyDayInput { day_of_week: number; periods: AvailabilityPeriod[]; is_active?: boolean }
export interface ExceptionInput { clinic_id?: string | null; local_date: string; type: keyof typeof AvailabilityExceptionTypeEnum; periods?: AvailabilityPeriod[]; reason?: string | null }
export interface BookingSettingsInput {
    appointment_duration?: number; slot_interval?: number; buffer_before?: number; buffer_after?: number;
    booking_lead_time_hours?: number; cancellation_window_hours?: number; accept_auto_booking?: boolean;
    allow_reschedule?: boolean; accepting_new_patients?: boolean;
    max_appointments_per_day?: number;
}
const availabilityDto = (row: any) => ({ _id: String(row._id), doctorId: String(row.doctor_id), clinicId: String(row.clinic_id), dayOfWeek: row.day_of_week, periods: row.periods.map((period: any) => ({ start_time: period.start_time, end_time: period.end_time })), isActive: row.is_active, createdAt: row.createdAt, updatedAt: row.updatedAt });
const exceptionDto = (row: any) => ({ _id: String(row._id), doctorId: String(row.doctor_id), clinicId: row.clinic_id ? String(row.clinic_id) : null, localDate: row.local_date, type: row.type, periods: row.periods.map((period: any) => ({ start_time: period.start_time, end_time: period.end_time })), reason: row.reason ?? null, createdByType: row.created_by_type, createdAt: row.createdAt, updatedAt: row.updatedAt });
const settingsDto = (doctor: any) => ({ appointmentDuration: doctor.appointment_duration, slotInterval: doctor.slot_interval, bufferBefore: doctor.buffer_before, bufferAfter: doctor.buffer_after, bookingLeadTimeHours: doctor.booking_lead_time_hours, cancellationWindowHours: doctor.cancellation_window_hours, maxAppointmentsPerDay: doctor.max_appointments_per_day ?? DEFAULT_MAX_APPOINTMENTS_PER_DAY, acceptAutoBooking: doctor.accept_auto_booking, allowReschedule: doctor.allow_reschedule, acceptingNewPatients: doctor.accepting_new_patients });

export class DoctorAvailabilityService {
    async requireDoctorClinic(doctorId: string, clinicId: string) {
        const [doctor, clinic] = await Promise.all([Doctor.findById(oid(doctorId, 'معرف الطبيب')).exec(), Clinic.findById(oid(clinicId, 'معرف العيادة')).exec()]);
        if (!doctor) throw new DomainError('الطبيب غير موجود', 404, 'DOCTOR_NOT_BOOKABLE');
        if (!clinic) throw new DomainError('العيادة غير موجودة', 404, 'DOCTOR_NOT_AT_CLINIC');
        if (!doctor.clinic_ids.some(id => String(id) === clinicId)) throw new DomainError('الطبيب غير مرتبط بهذه العيادة', 422, 'DOCTOR_NOT_AT_CLINIC');
        return { doctor, clinic };
    }
    async weekly(doctorId: string, clinicId: string) {
        await this.requireDoctorClinic(doctorId, clinicId);
        const rows = await DoctorAvailability.find({ doctor_id: oid(doctorId), clinic_id: oid(clinicId) }).sort({ day_of_week: 1 }).exec();
        return rows.map(availabilityDto);
    }
    async replaceWeekly(doctorId: string, clinicId: string, days: WeeklyDayInput[], actor: AppointmentActor) {
        await this.requireDoctorClinic(doctorId, clinicId);
        if (new Set(days.map(day => day.day_of_week)).size !== days.length || days.some(day => !Number.isInteger(day.day_of_week) || day.day_of_week < 0 || day.day_of_week > 6)) throw new DomainError('أيام الجدول غير صالحة أو مكررة', 400, 'AVAILABILITY_INVALID');
        const operations = days.map(day => ({ updateOne: {
            filter: { doctor_id: oid(doctorId), clinic_id: oid(clinicId), day_of_week: day.day_of_week },
            update: { $set: { periods: validateAvailabilityPeriods(day.periods), is_active: day.is_active ?? true } }, upsert: true,
        } }));
        if (operations.length) await DoctorAvailability.bulkWrite(operations);
        await this.audit(actor, doctorId, 'weekly', { clinic_id: clinicId, days });
        return this.weekly(doctorId, clinicId);
    }
    async exceptions(doctorId: string, from?: string, to?: string) {
        const filter: Record<string, unknown> = { doctor_id: oid(doctorId, 'معرف الطبيب') };
        if (from || to) filter.local_date = { ...(from ? { $gte: assertLocalDate(from) } : {}), ...(to ? { $lte: assertLocalDate(to) } : {}) };
        const rows = await DoctorAvailabilityException.find(filter).sort({ local_date: 1, clinic_id: 1 }).exec();
        return rows.map(exceptionDto);
    }
    async createException(doctorId: string, input: ExceptionInput, actor: AppointmentActor) {
        if (input.clinic_id) await this.requireDoctorClinic(doctorId, input.clinic_id); else if (!await Doctor.exists({ _id: oid(doctorId) })) throw new DomainError('الطبيب غير موجود', 404, 'DOCTOR_NOT_BOOKABLE');
        const periods = input.type === AvailabilityExceptionTypeEnum.CLOSED ? [] : validateAvailabilityPeriods(input.periods ?? []);
        if (input.type === AvailabilityExceptionTypeEnum.CUSTOM_HOURS && !periods.length) throw new DomainError('الساعات المخصصة مطلوبة', 400, 'AVAILABILITY_INVALID');
        try {
            const result = await DoctorAvailabilityException.create({ doctor_id: oid(doctorId), clinic_id: input.clinic_id ? oid(input.clinic_id) : null, local_date: assertLocalDate(input.local_date), type: input.type, periods, reason: input.reason?.trim() || null, created_by_user_id: actor.userId ? oid(actor.userId) : null, created_by_type: actor.type });
            await this.audit(actor, doctorId, 'exception/create', input, String(result._id)); return exceptionDto(result);
        } catch (error: any) { if (error?.code === 11000) throw new DomainError('يوجد استثناء لهذا اليوم والعيادة', 409, 'AVAILABILITY_OVERLAP'); throw error; }
    }
    async updateException(doctorId: string, exceptionId: string, input: Partial<ExceptionInput>, actor: AppointmentActor) {
        const current = await DoctorAvailabilityException.findOne({ _id: oid(exceptionId, 'معرف الاستثناء'), doctor_id: oid(doctorId) }).exec();
        if (!current) throw new DomainError('استثناء الدوام غير موجود', 404, 'APPOINTMENT_NOT_FOUND');
        if (input.clinic_id) await this.requireDoctorClinic(doctorId, input.clinic_id);
        const type = input.type ?? current.type;
        const periods = type === AvailabilityExceptionTypeEnum.CLOSED ? [] : validateAvailabilityPeriods(input.periods ?? current.periods.map(p => ({ start_time: p.start_time, end_time: p.end_time })));
        if (type === AvailabilityExceptionTypeEnum.CUSTOM_HOURS && !periods.length) throw new DomainError('الساعات المخصصة مطلوبة', 400, 'AVAILABILITY_INVALID');
        const updated = await DoctorAvailabilityException.findOneAndUpdate({ _id: current._id, doctor_id: oid(doctorId) }, { $set: { ...(input.local_date ? { local_date: assertLocalDate(input.local_date) } : {}), ...(input.clinic_id !== undefined ? { clinic_id: input.clinic_id ? oid(input.clinic_id) : null } : {}), type, periods, ...(input.reason !== undefined ? { reason: input.reason?.trim() || null } : {}) } }, { returnDocument: 'after', runValidators: true }).exec();
        await this.audit(actor, doctorId, 'exception/update', input, exceptionId); return exceptionDto(updated);
    }
    async deleteException(doctorId: string, exceptionId: string, actor: AppointmentActor) {
        const deleted = await DoctorAvailabilityException.findOneAndDelete({ _id: oid(exceptionId, 'معرف الاستثناء'), doctor_id: oid(doctorId) }).exec();
        if (!deleted) throw new DomainError('استثناء الدوام غير موجود', 404, 'APPOINTMENT_NOT_FOUND');
        await this.audit(actor, doctorId, 'exception/delete', {}, exceptionId); return deleted;
    }
    async updateSettings(doctorId: string, input: BookingSettingsInput, actor: AppointmentActor) {
        if (input.max_appointments_per_day !== undefined && (!Number.isInteger(input.max_appointments_per_day) || input.max_appointments_per_day < 1 || input.max_appointments_per_day > MAX_MAX_APPOINTMENTS_PER_DAY)) throw new DomainError('الحد اليومي للمواعيد يجب أن يكون بين 1 و200', 400, 'AVAILABILITY_INVALID');
        for (const [key, value] of Object.entries(input)) {
            if (typeof value === 'number' && (!Number.isFinite(value) || value < (key === 'appointment_duration' || key === 'slot_interval' ? 5 : 0))) throw new DomainError('إعدادات الحجز غير صالحة', 400, 'AVAILABILITY_INVALID');
        }
        const updated = await Doctor.findByIdAndUpdate(oid(doctorId, 'معرف الطبيب'), { $set: input }, { returnDocument: 'after', runValidators: true }).exec();
        if (!updated) throw new DomainError('الطبيب غير موجود', 404, 'DOCTOR_NOT_BOOKABLE');
        await this.audit(actor, doctorId, 'settings', input); return settingsDto(updated);
    }
    private async audit(actor: AppointmentActor, doctorId: string, action: string, body: unknown, documentId?: string) {
        try { await ActivityLogService.logActivity({ user_id: actor.userId, user_name: `${actor.type.toLowerCase()}_${actor.userId ?? 'system'}`, user_type: actor.type.toLowerCase(), method: action.endsWith('delete') ? 'DELETE' : 'PUT', endpoint: `/appointments/availability/${action}`, action: action.endsWith('delete') ? IActivityLogActionEnum.DELETE : IActivityLogActionEnum.UPDATE, collection_name: 'doctor_availability', document_id: documentId ?? doctorId, request_body: body, source: IActivityLogSourceEnum.DASHBOARD }); } catch {}
    }
}
export default new DoctorAvailabilityService();
