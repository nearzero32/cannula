import mongoose from 'mongoose';
import Appointment, { type AppointmentDocument } from '../models/appointments.model';
import AppointmentHistory from '../models/appointment-history.model';
import Doctor from '../models/doctors.model';
import { AppointmentActorTypeEnum, IAppointmentStatusEnum, type IAppointmentStatus } from '../interfaces/appointment.interface';
import { minutesUntil, toBaghdadLocal } from './appointment-time.service';
import { DomainError } from './domain-error';

export interface AppointmentListQuery {
    page?: number; limit?: number; doctorId?: string; clinicId?: string; patientId?: string; childId?: string;
    status?: IAppointmentStatus; beneficiaryType?: string; bookingSource?: string; paymentStatus?: string; from?: Date; to?: Date;
    search?: string; view?: 'upcoming' | 'past' | 'cancelled';
}
const id = (value: string) => mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : null;
const safeRange = (from?: Date, to?: Date) => {
    if (from && Number.isNaN(from.getTime()) || to && Number.isNaN(to.getTime())) throw new DomainError('نطاق التاريخ غير صالح', 400, 'APPOINTMENT_DATE_INVALID');
    if (from && to && (to < from || to.getTime() - from.getTime() > 93 * 86_400_000)) throw new DomainError('نطاق التقويم يجب ألا يتجاوز 93 يوماً', 400, 'APPOINTMENT_DATE_INVALID');
    return from || to ? { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } : undefined;
};
export function appointmentCapabilities(appointment: AppointmentDocument, cancellationWindowHours: number, allowReschedule: boolean, now = new Date()) {
    const active = [IAppointmentStatusEnum.PENDING, IAppointmentStatusEnum.CONFIRMED].includes(appointment.status as any);
    const outsideWindow = minutesUntil(appointment.starts_at, now) >= cancellationWindowHours * 60;
    return { canCancel: active && outsideWindow, canReschedule: active && outsideWindow && allowReschedule };
}
export function formatAppointment(appointment: any, options: { includeInternal?: boolean; capabilities?: { canCancel: boolean; canReschedule: boolean } } = {}) {
    const start = toBaghdadLocal(new Date(appointment.starts_at)), end = toBaghdadLocal(new Date(appointment.ends_at));
    // Elysia validates this DTO against AppointmentSchema at the controller boundary.
    // Keep the return type open here because Mongoose's hydrated document fields are
    // intentionally normalised from snake_case/Date/ObjectId into the public shape.
    const data: any = {
        _id: String(appointment._id), appointmentNumber: appointment.appointment_number, patientId: String(appointment.patient_id),
        beneficiaryType: appointment.beneficiary_type, childId: appointment.child_id ? String(appointment.child_id) : null,
        doctorId: String(appointment.doctor_id), clinicId: String(appointment.clinic_id), specialtyId: appointment.specialty_id ? String(appointment.specialty_id) : null,
        startsAt: new Date(appointment.starts_at).toISOString(), endsAt: new Date(appointment.ends_at).toISOString(), localDate: start.date,
        localStartsAt: start.time, localEndsAt: end.time, timezone: start.timezone, status: appointment.status,
        bookingSource: appointment.booking_source, reason: appointment.reason ?? null, doctor: appointment.snapshot.doctor,
        clinic: appointment.snapshot.clinic, specialty: appointment.snapshot.specialty ?? null, beneficiary: appointment.snapshot.beneficiary,
        pricing: appointment.snapshot.pricing, paymentStatus: appointment.payment_status, rescheduledFrom: appointment.rescheduled_from ? String(appointment.rescheduled_from) : null,
        rescheduledTo: appointment.rescheduled_to ? String(appointment.rescheduled_to) : null, cancellation: appointment.cancellation ? { reason: appointment.cancellation.reason ?? null, actorType: appointment.cancellation.actor_type, at: appointment.cancellation.at } : null,
        capabilities: options.capabilities ?? undefined, createdAt: appointment.createdAt, updatedAt: appointment.updatedAt,
    };
    if (options.includeInternal) data.notesInternal = appointment.notes_internal ?? null;
    return data;
}

export class AppointmentService {
    async patientDtos(appointments: AppointmentDocument[], now = new Date()) {
        const doctorIds = [...new Set(appointments.map(item => String(item.doctor_id)))];
        const doctors = await Doctor.find({ _id: { $in: doctorIds } }).select('cancellation_window_hours allow_reschedule').exec();
        const settings = new Map(doctors.map(doctor => [String(doctor._id), doctor]));
        return appointments.map(appointment => {
            const doctor = settings.get(String(appointment.doctor_id));
            return formatAppointment(appointment, { capabilities: appointmentCapabilities(appointment, doctor?.cancellation_window_hours ?? Infinity, doctor?.allow_reschedule ?? false, now) });
        });
    }
    async list(query: AppointmentListQuery) {
        const page = Math.max(1, query.page ?? 1), limit = Math.min(100, Math.max(1, query.limit ?? 20));
        const filter: Record<string, any> = {};
        for (const [field, value] of [['doctor_id', query.doctorId], ['clinic_id', query.clinicId], ['patient_id', query.patientId], ['child_id', query.childId]] as const) {
            if (value) { const objectId = id(value); if (!objectId) throw new DomainError('معرف البحث غير صالح', 400, 'APPOINTMENT_INVALID'); filter[field] = objectId; }
        }
        if (query.status) filter.status = query.status;
        if (query.beneficiaryType) filter.beneficiary_type = query.beneficiaryType;
        if (query.bookingSource) filter.booking_source = query.bookingSource;
        if (query.paymentStatus) filter.payment_status = query.paymentStatus;
        const range = safeRange(query.from, query.to); if (range) filter.starts_at = range;
        const now = new Date();
        if (query.view === 'upcoming') filter.starts_at = { ...(filter.starts_at ?? {}), $gte: now };
        if (query.view === 'past') filter.starts_at = { ...(filter.starts_at ?? {}), $lt: now };
        if (query.view === 'cancelled') filter.status = IAppointmentStatusEnum.CANCELLED;
        if (query.search?.trim()) filter.$or = [{ appointment_number: { $regex: query.search.trim(), $options: 'i' } }, { 'snapshot.beneficiary.display_name': { $regex: query.search.trim(), $options: 'i' } }, { 'snapshot.doctor.display_name': { $regex: query.search.trim(), $options: 'i' } }];
        const [data, count] = await Promise.all([Appointment.find(filter).sort({ starts_at: query.view === 'upcoming' ? 1 : -1 }).skip((page - 1) * limit).limit(limit).exec(), Appointment.countDocuments(filter).exec()]);
        return { data, count, page, limit };
    }
    async byId(appointmentId: string) {
        const objectId = id(appointmentId); if (!objectId) throw new DomainError('معرف الموعد غير صالح', 400, 'APPOINTMENT_INVALID');
        const appointment = await Appointment.findById(objectId).exec(); if (!appointment) throw new DomainError('الموعد غير موجود', 404, 'APPOINTMENT_NOT_FOUND'); return appointment;
    }
    async patientAppointment(appointmentId: string, patientId: string) {
        const objectId = id(appointmentId); if (!objectId) throw new DomainError('معرف الموعد غير صالح', 400, 'APPOINTMENT_INVALID');
        const appointment = await Appointment.findOne({ _id: objectId, patient_id: id(patientId) }).exec(); if (!appointment) throw new DomainError('الموعد غير موجود', 404, 'APPOINTMENT_NOT_OWNED'); return appointment;
    }
    async doctorAppointment(appointmentId: string, doctorId: string) {
        const appointment = await this.byId(appointmentId); if (String(appointment.doctor_id) !== doctorId) throw new DomainError('غير مصرح بإدارة هذا الموعد', 403, 'APPOINTMENT_NOT_OWNED'); return appointment;
    }
    async history(appointmentId: string, publicView = false) {
        const objectId = id(appointmentId); if (!objectId) throw new DomainError('معرف الموعد غير صالح', 400, 'APPOINTMENT_INVALID');
        const rows = await AppointmentHistory.find({ appointment_id: objectId }).sort({ createdAt: 1, _id: 1 }).exec();
        return rows.map((row: any) => ({ eventType: row.event_type, fromStatus: row.from_status ?? null, toStatus: row.to_status ?? null, actorType: row.actor_type, reason: row.reason ?? null, ...(publicView ? {} : { actorUserId: row.actor_user_id ? String(row.actor_user_id) : null, metadata: row.metadata ?? null }), createdAt: row.createdAt }));
    }
}
export default new AppointmentService();
