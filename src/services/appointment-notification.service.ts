import mongoose from 'mongoose';
import Appointment from '../models/appointments.model';
import notificationService from './notification.service';
import appointmentDomainEventService, { type AppointmentDomainEvent } from './appointment-domain-event.service';
import { AppointmentActorTypeEnum } from '../interfaces/appointment.interface';
import { INotificationRecipientModelEnum, INotificationTypeEnum, type INotificationRecipientModel, type INotificationType } from '../interfaces/notification.interface';
import { toBaghdadLocal } from './appointment-time.service';

type Target = { id: mongoose.Types.ObjectId; model: INotificationRecipientModel };
let registered = false;

const typeByEvent: Record<string, INotificationType | undefined> = {
    APPOINTMENT_CREATED: INotificationTypeEnum.APPOINTMENT_BOOKED,
    APPOINTMENT_CONFIRMED: INotificationTypeEnum.APPOINTMENT_CONFIRMED,
    APPOINTMENT_CANCELLED: INotificationTypeEnum.APPOINTMENT_CANCELLED,
    APPOINTMENT_RESCHEDULED: INotificationTypeEnum.APPOINTMENT_RESCHEDULED,
    APPOINTMENT_COMPLETED: INotificationTypeEnum.APPOINTMENT_COMPLETED,
    APPOINTMENT_NO_SHOW: INotificationTypeEnum.APPOINTMENT_NO_SHOW,
};

async function handle(event: AppointmentDomainEvent) {
    const type = typeByEvent[event.type];
    if (!type || !mongoose.Types.ObjectId.isValid(event.appointmentId)) return;
    const appointment = await Appointment.findById(event.appointmentId).select('patient_id doctor_id starts_at local_date snapshot workflow_version').lean().exec();
    if (!appointment) return;
    const actorType = event.data?.actorType;
    const patient: Target = { id: appointment.patient_id, model: INotificationRecipientModelEnum.PATIENT };
    const doctor: Target = { id: appointment.doctor_id, model: INotificationRecipientModelEnum.DOCTOR };
    let targets: Target[];
    if (event.type === 'APPOINTMENT_CREATED') targets = [patient, doctor];
    else if (event.type === 'APPOINTMENT_CANCELLED') targets = actorType === AppointmentActorTypeEnum.PATIENT ? [doctor] : [patient];
    else if (event.type === 'APPOINTMENT_RESCHEDULED') targets = [patient, doctor];
    else targets = [patient];
    const local = toBaghdadLocal(new Date(appointment.starts_at));
    const title = event.type === 'APPOINTMENT_CREATED' ? 'موعد جديد' : event.type === 'APPOINTMENT_CONFIRMED' ? 'تم تأكيد الموعد' : event.type === 'APPOINTMENT_CANCELLED' ? 'تم إلغاء الموعد' : event.type === 'APPOINTMENT_RESCHEDULED' ? 'تمت إعادة جدولة الموعد' : event.type === 'APPOINTMENT_COMPLETED' ? 'اكتمل الموعد' : 'حالة الموعد';
    const body = `${appointment.snapshot.doctor.display_name} - ${local.date} ${local.time}`;
    for (const target of targets) {
        const dedupeKey = `appointment:${event.appointmentId}:${appointment.workflow_version}:${type}:${target.model}:${String(target.id)}`;
        const { notification, created } = await notificationService.createOnce({ recipient_ids: [target.id], recipient_model: target.model, type, title, body, appointment_id: new mongoose.Types.ObjectId(event.appointmentId), data: { appointmentId: event.appointmentId, startsAt: new Date(appointment.starts_at).toISOString(), localDate: local.date, localTime: local.time } }, dedupeKey);
        if (created) void notificationService.dispatch(String(notification._id)).catch(() => undefined);
    }
}

export function registerAppointmentNotificationHandler() {
    if (registered) return;
    registered = true;
    appointmentDomainEventService.subscribe(handle);
}

export const DURABLE_APPOINTMENT_REMINDERS_PENDING = true as const;
