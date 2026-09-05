import mongoose, { type ClientSession } from 'mongoose';
import Appointment, { APPOINTMENT_BLOCKING_STATUSES, type AppointmentDocument } from '../models/appointments.model';
import AppointmentHistory from '../models/appointment-history.model';
import AppointmentCounter from '../models/appointment-counter.model';
import AppointmentDayLock from '../models/appointment-day-lock.model';
import Patient from '../models/patients.model';
import PatientChild from '../models/patient-child.model';
import Doctor from '../models/doctors.model';
import { IPatientStatusEnum } from '../interfaces/patient.interface';
import { PatientChildStatusEnum } from '../interfaces/patient-child.interface';
import {
    AppointmentActorTypeEnum, AppointmentBeneficiaryTypeEnum, AppointmentHistoryEventEnum,
    IAppointmentBookingSourceEnum, IAppointmentPaymentStatusEnum, IAppointmentStatusEnum,
    type AppointmentActor, type AppointmentBeneficiaryType, type IAppointmentBookingSource, type IAppointmentPaymentStatus, type IAppointmentStatus,
} from '../interfaces/appointment.interface';
import appointmentSlotService, { type AppointmentSlotService } from './appointment-slot.service';
import transactionRunner, { type AppointmentTransactionRunner } from './appointment-transaction.service';
import { appendAppointmentNotification } from './appointment-notification.service';
import appointmentReminderService from './appointment-reminder.service';
import ActivityLogService from './activity-log.service';
import { IActivityLogActionEnum, IActivityLogSourceEnum } from '../interfaces/activity-log.interface';
import { assertLocalDate, minutesUntil, toBaghdadLocal } from './appointment-time.service';
import { DomainError } from './domain-error';

const oid = (value: string, code = 'APPOINTMENT_INVALID') => {
    if (!mongoose.Types.ObjectId.isValid(value)) throw new DomainError('المعرف غير صالح', 400, code);
    return new mongoose.Types.ObjectId(value);
};
const inSession = <T extends { session(session: ClientSession): T }>(query: T, session: ClientSession | null) => session ? query.session(session) : query;
const actorProfileId = (actor: AppointmentActor) => actor.type === AppointmentActorTypeEnum.PATIENT ? actor.patientId : actor.type === AppointmentActorTypeEnum.DOCTOR ? actor.doctorId : null;
const clean = (value?: string | null) => value?.trim() || null;

export interface AppointmentBookingInput {
    patientId: string; doctorId: string; clinicId: string; specialtyId?: string | null; date: string; startsAt: string;
    beneficiary: { type: AppointmentBeneficiaryType; childId?: string | null }; reason?: string | null;
    source: IAppointmentBookingSource; bookedByUserId?: string | null; initialStatus?: typeof IAppointmentStatusEnum.PENDING | typeof IAppointmentStatusEnum.CONFIRMED;
}
export interface AppointmentRescheduleInput { doctorId?: string; clinicId?: string; specialtyId?: string | null; date: string; startsAt: string; reason?: string | null }

export const APPOINTMENT_TRANSITIONS = {
    confirm: { from: [IAppointmentStatusEnum.PENDING], to: IAppointmentStatusEnum.CONFIRMED, event: AppointmentHistoryEventEnum.CONFIRMED, timestamp: 'confirmed_at' },
    checkIn: { from: [IAppointmentStatusEnum.CONFIRMED], to: IAppointmentStatusEnum.CHECKED_IN, event: AppointmentHistoryEventEnum.CHECKED_IN, timestamp: 'checked_in_at' },
    start: { from: [IAppointmentStatusEnum.CHECKED_IN], to: IAppointmentStatusEnum.IN_PROGRESS, event: AppointmentHistoryEventEnum.STARTED, timestamp: 'started_at' },
    complete: { from: [IAppointmentStatusEnum.IN_PROGRESS], to: IAppointmentStatusEnum.COMPLETED, event: AppointmentHistoryEventEnum.COMPLETED, timestamp: 'completed_at' },
    noShow: { from: [IAppointmentStatusEnum.CONFIRMED], to: IAppointmentStatusEnum.NO_SHOW, event: AppointmentHistoryEventEnum.NO_SHOW, timestamp: 'no_show_at' },
} satisfies Record<string, { from: IAppointmentStatus[]; to: IAppointmentStatus; event: string; timestamp?: string }>;
export type AppointmentWorkflowAction = keyof typeof APPOINTMENT_TRANSITIONS;
export function appointmentTransition(action: AppointmentWorkflowAction, current: IAppointmentStatus) {
    const policy = APPOINTMENT_TRANSITIONS[action];
    if (!(policy.from as IAppointmentStatus[]).includes(current)) throw new DomainError('انتقال حالة الموعد غير صالح', 409, 'APPOINTMENT_INVALID_TRANSITION');
    return policy;
}
export function initialAppointmentStatus(autoConfirm: boolean, explicit?: typeof IAppointmentStatusEnum.PENDING | typeof IAppointmentStatusEnum.CONFIRMED) {
    return explicit ?? (autoConfirm ? IAppointmentStatusEnum.CONFIRMED : IAppointmentStatusEnum.PENDING);
}

export class AppointmentWorkflowService {
    constructor(private transactions: AppointmentTransactionRunner = transactionRunner, private slots: AppointmentSlotService = appointmentSlotService) {}

    async create(input: AppointmentBookingInput, actor: AppointmentActor, now = new Date()) {
        let result: AppointmentDocument;
        try {
            result = await this.transactions.run(async session => this.createInTransaction(input, actor, session, now));
        } catch (error) {
            throw await this.withAvailabilitySuggestions(error, input, now, actor);
        }
        await this.afterMutation(result, AppointmentHistoryEventEnum.CREATED, actor, input); return result;
    }
    private async lock(doctorId: string, date: string, session: ClientSession | null) {
        const query = AppointmentDayLock.findOneAndUpdate({ _id: `${doctorId}:${date}` }, { $inc: { revision: 1 }, $set: { touched_at: new Date() } }, { upsert: true, returnDocument: 'after' });
        await inSession(query, session).exec();
    }
    private async nextNumber(localDate: string, session: ClientSession | null) {
        const year = assertLocalDate(localDate).slice(0, 4);
        const query = AppointmentCounter.findOneAndUpdate({ _id: `appointment:${year}` }, { $inc: { sequence: 1 } }, { upsert: true, returnDocument: 'after' });
        const counter = await inSession(query, session).exec();
        return `APP-${year}-${String(counter!.sequence).padStart(6, '0')}`;
    }
    private async createInTransaction(input: AppointmentBookingInput, actor: AppointmentActor, session: ClientSession | null, now: Date, rescheduledFrom?: string, dayAlreadyLocked = false) {
        const date = assertLocalDate(input.date); if (!dayAlreadyLocked) await this.lock(input.doctorId, date, session);
        const patient = await inSession(Patient.findById(oid(input.patientId)), session).exec();
        if (!patient || patient.status !== IPatientStatusEnum.ACTIVE) throw new DomainError('المريض غير متاح للحجز', 404, 'APPOINTMENT_NOT_OWNED');
        let child: any = null;
        if (input.beneficiary.type === AppointmentBeneficiaryTypeEnum.CHILD) {
            if (!input.beneficiary.childId) throw new DomainError('معرف الطفل مطلوب', 400, 'APPOINTMENT_BENEFICIARY_INVALID');
            child = await inSession(PatientChild.findOne({ _id: oid(input.beneficiary.childId), patient_id: patient._id }), session).exec();
            if (!child) throw new DomainError('الطفل غير موجود', 404, 'APPOINTMENT_NOT_OWNED');
            if (child.status !== PatientChildStatusEnum.ACTIVE) throw new DomainError('لا يمكن الحجز لطفل غير فعال', 422, 'APPOINTMENT_BENEFICIARY_INVALID');
        }
        let slotResult;
        try {
            slotResult = await this.slots.requireSlot({ doctorId: input.doctorId, clinicId: input.clinicId, specialtyId: input.specialtyId, date, startsAt: input.startsAt }, { session, now, enforceLeadTime: actor.type === AppointmentActorTypeEnum.PATIENT, excludeAppointmentId: rescheduledFrom });
        } catch (error) {
            if (error instanceof DomainError && error.code === 'APPOINTMENT_SLOT_UNAVAILABLE') throw new DomainError('تعارض الموعد المختار مع حجز آخر أو لم يعد متاحاً', 409, 'APPOINTMENT_SLOT_UNAVAILABLE');
            throw error;
        }
        const { doctor, clinic, specialty } = slotResult.context, slot = slotResult.slot;
        const status = initialAppointmentStatus(doctor.accept_auto_booking, input.initialStatus);
        const payload = {
            appointment_number: await this.nextNumber(date, session), patient_id: patient._id, beneficiary_type: input.beneficiary.type,
            child_id: child?._id ?? null, doctor_id: doctor._id, clinic_id: clinic._id, specialty_id: specialty?._id ?? null, local_date: date,
            starts_at: new Date(slot.startsAt), ends_at: new Date(slot.endsAt), blocked_starts_at: new Date(slot.blockedStartsAt), blocked_ends_at: new Date(slot.blockedEndsAt),
            status, booking_source: input.source, booked_by_user_id: input.bookedByUserId ? oid(input.bookedByUserId) : null,
            reason: clean(input.reason), notes_internal: null, payment_status: IAppointmentPaymentStatusEnum.UNPAID,
            snapshot: { doctor: { display_name: doctor.display_name, profile_photo: doctor.profile_photo ?? null }, clinic: { name: clinic.name, address: clinic.address }, specialty: specialty ? { name: specialty.name } : null, beneficiary: { type: input.beneficiary.type, display_name: child?.full_name ?? patient.full_name }, pricing: { fee: doctor.consultation_fee ?? 0, currency: doctor.currency ?? 'IQD' } },
            rescheduled_from: rescheduledFrom ? oid(rescheduledFrom) : null, confirmed_at: status === IAppointmentStatusEnum.CONFIRMED ? now : null, workflow_version: 0,
        };
        const appointment = session ? (await Appointment.create([payload], { session }))[0] : await Appointment.create(payload);
        await this.history(appointment, AppointmentHistoryEventEnum.CREATED, actor, null, status, input.reason, rescheduledFrom ? { rescheduledFrom } : null, session); await appendAppointmentNotification(appointment,rescheduledFrom?'RESCHEDULED':'CREATED',actor.type,session); if(status===IAppointmentStatusEnum.CONFIRMED)await appointmentReminderService.scheduleForConfirmedAppointment(appointment,session,now);
        return appointment;
    }
    private async owned(id: string, actor: AppointmentActor, session: ClientSession | null) {
        const query = Appointment.findById(oid(id));
        const appointment = session ? await query.session(session).exec() : await query.exec();
        if (!appointment) throw new DomainError('الموعد غير موجود', 404, 'APPOINTMENT_NOT_FOUND');
        if (actor.type === AppointmentActorTypeEnum.PATIENT && String(appointment.patient_id) !== actor.patientId) throw new DomainError('الموعد غير موجود', 404, 'APPOINTMENT_NOT_OWNED');
        if (actor.type === AppointmentActorTypeEnum.DOCTOR && String(appointment.doctor_id) !== actor.doctorId) throw new DomainError('غير مصرح بإدارة هذا الموعد', 403, 'APPOINTMENT_NOT_OWNED');
        return appointment;
    }
    async act(id: string, action: AppointmentWorkflowAction, actor: AppointmentActor, reason?: string | null, now = new Date()) {
        const result = await this.transactions.run(async session => {
            const current = await this.owned(id, actor, session);
            const policy = appointmentTransition(action, current.status);
            const set: Record<string, unknown> = { status: policy.to }; if (policy.timestamp) set[policy.timestamp] = now;
            const updated = await inSession(Appointment.findOneAndUpdate({ _id: current._id, status: current.status, workflow_version: current.workflow_version }, { $set: set, $inc: { workflow_version: 1 } }, { returnDocument: 'after', runValidators: true }), session).exec();
            if (!updated) throw new DomainError('تم تعديل الموعد بالتزامن', 409, 'APPOINTMENT_INVALID_TRANSITION');
            await this.history(updated, policy.event, actor, current.status, policy.to, reason, null, session); if(action==='confirm'||action==='complete'||action==='noShow')await appendAppointmentNotification(updated,action==='confirm'?'CONFIRMED':action==='complete'?'COMPLETED':'NO_SHOW',actor.type,session); if(action==='confirm')await appointmentReminderService.scheduleForConfirmedAppointment(updated,session,now); if(action==='complete'||action==='noShow')await appointmentReminderService.cancelFutureForAppointment(updated._id,session); return updated;
        });
        await this.afterMutation(result, APPOINTMENT_TRANSITIONS[action].event, actor, { reason }); return result;
    }
    confirm(id: string, actor: AppointmentActor) { return this.act(id, 'confirm', actor); }
    checkIn(id: string, actor: AppointmentActor) { return this.act(id, 'checkIn', actor); }
    start(id: string, actor: AppointmentActor) { return this.act(id, 'start', actor); }
    complete(id: string, actor: AppointmentActor) { return this.act(id, 'complete', actor); }
    noShow(id: string, actor: AppointmentActor) { return this.act(id, 'noShow', actor); }
    async cancel(id: string, actor: AppointmentActor, reason?: string | null, now = new Date()) {
        const result = await this.transactions.run(async session => {
            const current = await this.owned(id, actor, session);
            if (![IAppointmentStatusEnum.PENDING, IAppointmentStatusEnum.CONFIRMED].includes(current.status as any)) throw new DomainError('لا يمكن إلغاء الموعد في حالته الحالية', 409, 'APPOINTMENT_INVALID_TRANSITION');
            if (actor.type === AppointmentActorTypeEnum.PATIENT) {
                const doctor = await inSession(Doctor.findById(current.doctor_id), session).exec();
                if (!doctor || minutesUntil(current.starts_at, now) < doctor.cancellation_window_hours * 60) throw new DomainError('انتهت نافذة إلغاء الموعد', 409, 'APPOINTMENT_CANCELLATION_WINDOW_CLOSED');
            }
            const cancellation = { reason: clean(reason), actor_type: actor.type, actor_user_id: actor.userId ? oid(actor.userId) : null, at: now };
            const updated = await inSession(Appointment.findOneAndUpdate({ _id: current._id, status: current.status, workflow_version: current.workflow_version }, { $set: { status: IAppointmentStatusEnum.CANCELLED, cancellation }, $inc: { workflow_version: 1 } }, { returnDocument: 'after' }), session).exec();
            if (!updated) throw new DomainError('تم تعديل الموعد بالتزامن', 409, 'APPOINTMENT_INVALID_TRANSITION');
            await this.history(updated, AppointmentHistoryEventEnum.CANCELLED, actor, current.status, IAppointmentStatusEnum.CANCELLED, reason, null, session); await appendAppointmentNotification(updated,'CANCELLED',actor.type,session); await appointmentReminderService.cancelFutureForAppointment(updated._id,session); return updated;
        });
        await this.afterMutation(result, AppointmentHistoryEventEnum.CANCELLED, actor, { reason }); return result;
    }
    async reschedule(id: string, input: AppointmentRescheduleInput, actor: AppointmentActor, now = new Date()) {
        const initial = await Appointment.findById(oid(id)).exec();
        if (!initial) throw new DomainError('الموعد غير موجود', 404, 'APPOINTMENT_NOT_FOUND');
        if (actor.type === AppointmentActorTypeEnum.PATIENT && String(initial.patient_id) !== actor.patientId) throw new DomainError('الموعد غير موجود', 404, 'APPOINTMENT_NOT_OWNED');
        if (actor.type === AppointmentActorTypeEnum.DOCTOR && String(initial.doctor_id) !== actor.doctorId) throw new DomainError('غير مصرح بإدارة هذا الموعد', 403, 'APPOINTMENT_NOT_OWNED');
        if (actor.type === AppointmentActorTypeEnum.PATIENT) {
            const doctor = await Doctor.findById(initial.doctor_id).exec();
            if (!doctor?.allow_reschedule) throw new DomainError('الطبيب لا يسمح بإعادة الجدولة', 409, 'APPOINTMENT_RESCHEDULE_NOT_ALLOWED');
            if (minutesUntil(initial.starts_at, now) < doctor.cancellation_window_hours * 60) throw new DomainError('انتهت نافذة إعادة الجدولة', 409, 'APPOINTMENT_CANCELLATION_WINDOW_CLOSED');
        }
        const destinationDoctorId = input.doctorId ?? String(initial.doctor_id);
        let result: { previous: AppointmentDocument; appointment: AppointmentDocument };
        try {
            result = await this.transactions.run(async session => {
            await this.lock(destinationDoctorId, assertLocalDate(input.date), session);
            const current = await this.owned(id, actor, session);
            if (![IAppointmentStatusEnum.PENDING, IAppointmentStatusEnum.CONFIRMED].includes(current.status as any)) throw new DomainError('لا يمكن إعادة جدولة الموعد', 409, 'APPOINTMENT_INVALID_TRANSITION');
            const currentDoctor = await inSession(Doctor.findById(current.doctor_id), session).exec();
            if (actor.type === AppointmentActorTypeEnum.PATIENT && (!currentDoctor || !currentDoctor.allow_reschedule)) throw new DomainError('الطبيب لا يسمح بإعادة الجدولة', 409, 'APPOINTMENT_RESCHEDULE_NOT_ALLOWED');
            if (actor.type === AppointmentActorTypeEnum.PATIENT && minutesUntil(current.starts_at, now) < (currentDoctor?.cancellation_window_hours ?? Infinity) * 60) throw new DomainError('انتهت نافذة إعادة الجدولة', 409, 'APPOINTMENT_CANCELLATION_WINDOW_CLOSED');
            const booking: AppointmentBookingInput = { patientId: String(current.patient_id), doctorId: input.doctorId ?? String(current.doctor_id), clinicId: input.clinicId ?? String(current.clinic_id), specialtyId: input.specialtyId === undefined ? current.specialty_id ? String(current.specialty_id) : null : input.specialtyId, date: input.date, startsAt: input.startsAt, beneficiary: { type: current.beneficiary_type, childId: current.child_id ? String(current.child_id) : null }, reason: current.reason, source: current.booking_source, bookedByUserId: actor.userId ?? null };
            const replacement = await this.createInTransaction(booking, actor, session, now, String(current._id), true);
            const updated = await inSession(Appointment.findOneAndUpdate({ _id: current._id, status: current.status, workflow_version: current.workflow_version }, { $set: { status: IAppointmentStatusEnum.RESCHEDULED, rescheduled_to: replacement._id }, $inc: { workflow_version: 1 } }, { returnDocument: 'after' }), session).exec();
            if (!updated) throw new DomainError('تم تعديل الموعد بالتزامن', 409, 'APPOINTMENT_INVALID_TRANSITION');
            await this.history(updated, AppointmentHistoryEventEnum.RESCHEDULED_FROM, actor, current.status, IAppointmentStatusEnum.RESCHEDULED, input.reason, { rescheduledTo: String(replacement._id) }, session);
            await this.history(replacement, AppointmentHistoryEventEnum.RESCHEDULED_TO, actor, null, replacement.status, input.reason, { rescheduledFrom: String(current._id) }, session);
                return { previous: updated, appointment: replacement };
            });
        } catch (error) {
            throw await this.withAvailabilitySuggestions(error, {
                doctorId: destinationDoctorId,
                clinicId: input.clinicId ?? String(initial.clinic_id),
                specialtyId: input.specialtyId === undefined ? initial.specialty_id ? String(initial.specialty_id) : null : input.specialtyId,
                date: input.date,
            }, now, actor);
        }
        await this.afterMutation(result.appointment, AppointmentHistoryEventEnum.RESCHEDULED_TO, actor, { previousId: id }); return result;
    }
    async updateInternalNotes(id: string, notes: string | null, actor: AppointmentActor) {
        if (actor.type === AppointmentActorTypeEnum.PATIENT) throw new DomainError('غير مصرح', 403, 'APPOINTMENT_NOT_OWNED');
        const result = await this.transactions.run(async session => {
            const current = await this.owned(id, actor, session);
            const updated = await inSession(Appointment.findByIdAndUpdate(current._id, { $set: { notes_internal: clean(notes) }, $inc: { workflow_version: 1 } }, { returnDocument: 'after' }), session).exec();
            await this.history(updated!, AppointmentHistoryEventEnum.INTERNAL_NOTE_UPDATED, actor, current.status, current.status, null, null, session); return updated!;
        });
        await this.afterMutation(result, AppointmentHistoryEventEnum.INTERNAL_NOTE_UPDATED, actor, { notesChanged: true });
        return result;
    }
    async updatePayment(id: string, paymentStatus: IAppointmentPaymentStatus, actor: AppointmentActor) {
        if (actor.type !== AppointmentActorTypeEnum.ADMIN) throw new DomainError('غير مصرح', 403, 'APPOINTMENT_NOT_OWNED');
        const result = await this.transactions.run(async session => {
            const current = await this.owned(id, actor, session);
            const updated = await inSession(Appointment.findByIdAndUpdate(current._id, { $set: { payment_status: paymentStatus }, $inc: { workflow_version: 1 } }, { returnDocument: 'after' }), session).exec();
            await this.history(updated!, AppointmentHistoryEventEnum.PAYMENT_STATUS_CHANGED, actor, current.status, current.status, null, { from: current.payment_status, to: paymentStatus }, session); return updated!;
        });
        await this.afterMutation(result, AppointmentHistoryEventEnum.PAYMENT_STATUS_CHANGED, actor, { paymentStatus });
        return result;
    }
    private async history(appointment: AppointmentDocument, event: string, actor: AppointmentActor, from: IAppointmentStatus | null, to: IAppointmentStatus | null, reason: string | null | undefined, metadata: unknown, session: ClientSession | null) {
        const payload = { appointment_id: appointment._id, appointment_number: appointment.appointment_number, event_type: event, from_status: from, to_status: to, actor_type: actor.type, actor_user_id: actor.userId ? oid(actor.userId) : null, actor_profile_id: actorProfileId(actor) ? oid(actorProfileId(actor)!) : null, reason: clean(reason), metadata };
        if (session) await AppointmentHistory.create([payload], { session }); else await AppointmentHistory.create(payload);
    }
    private async afterMutation(appointment: AppointmentDocument, event: string, actor: AppointmentActor, body: unknown) {
        if (actor.type !== AppointmentActorTypeEnum.PATIENT) try { await ActivityLogService.logActivity({ user_id: actor.userId, user_name: `${actor.type.toLowerCase()}_${actor.userId}`, user_type: actor.type.toLowerCase(), method: 'POST', endpoint: `/appointments/${String(appointment._id)}/${event.toLowerCase()}`, action: IActivityLogActionEnum.UPDATE, collection_name: 'appointments', document_id: appointment._id, request_body: body, source: IActivityLogSourceEnum.DASHBOARD }); } catch {}
    }
    private async withAvailabilitySuggestions(error: unknown, input: Pick<AppointmentBookingInput, 'doctorId' | 'clinicId' | 'specialtyId' | 'date'>, now: Date, actor: AppointmentActor) {
        if (!(error instanceof DomainError) || !['APPOINTMENT_DAILY_CAP_REACHED', 'APPOINTMENT_SLOT_UNAVAILABLE'].includes(error.code ?? '')) return error;
        try {
            const availability = await this.slots.getAvailability(input, { now, enforceLeadTime: actor.type === AppointmentActorTypeEnum.PATIENT });
            return new DomainError(error.message, error.status, error.code, { nextAvailable: availability.nextAvailable, nextAvailableOptions: availability.nextAvailableOptions });
        } catch { return error; }
    }
}
export default new AppointmentWorkflowService();
