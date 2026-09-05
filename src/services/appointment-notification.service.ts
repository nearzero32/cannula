import mongoose from 'mongoose';
import Appointment from '../models/appointments.model';
import Patient from '../models/patients.model';
import Doctor from '../models/doctors.model';
import domainNotificationService from './domain-notification.service';
import appointmentDomainEventService, { type AppointmentDomainEvent } from './appointment-domain-event.service';
import { AppointmentActorTypeEnum } from '../interfaces/appointment.interface';
import { INotificationCategoryEnum, INotificationPrivacyEnum, INotificationTypeEnum, type INotificationType } from '../interfaces/notification.interface';
import { toBaghdadLocal } from './appointment-time.service';

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
    const [patient,doctor]=await Promise.all([Patient.findById(appointment.patient_id).select('user_id').lean().exec(),Doctor.findById(appointment.doctor_id).select('user_id').lean().exec()]);
    if(!patient?.user_id||!doctor?.user_id){console.error(JSON.stringify({level:'error',event:'appointment_notification_identity_missing',appointmentId:event.appointmentId}));return;}
    let targets: mongoose.Types.ObjectId[];
    if (event.type === 'APPOINTMENT_CREATED') targets = [patient.user_id, doctor.user_id];
    else if (event.type === 'APPOINTMENT_CANCELLED') targets = actorType === AppointmentActorTypeEnum.PATIENT ? [doctor.user_id] : [patient.user_id];
    else if (event.type === 'APPOINTMENT_RESCHEDULED') targets = [patient.user_id, doctor.user_id];
    else targets = [patient.user_id];
    const local = toBaghdadLocal(new Date(appointment.starts_at));
    const title = event.type === 'APPOINTMENT_CREATED' ? 'موعد جديد' : event.type === 'APPOINTMENT_CONFIRMED' ? 'تم تأكيد الموعد' : event.type === 'APPOINTMENT_CANCELLED' ? 'تم إلغاء الموعد' : event.type === 'APPOINTMENT_RESCHEDULED' ? 'تمت إعادة جدولة الموعد' : event.type === 'APPOINTMENT_COMPLETED' ? 'اكتمل الموعد' : 'حالة الموعد';
    const body = `${appointment.snapshot.doctor.display_name} - ${local.date} ${local.time}`;
    for (const userId of targets) await domainNotificationService.targeted({userIds:[userId],dedupeKey:`appointment:${event.appointmentId}:${appointment.workflow_version}:${type}:${String(userId)}`,payload:{category:INotificationCategoryEnum.APPOINTMENTS,privacy:INotificationPrivacyEnum.NORMAL,type,title,body,source:{domain:'appointment',id:new mongoose.Types.ObjectId(event.appointmentId)},target:{type:'appointment',id:new mongoose.Types.ObjectId(event.appointmentId)},appointment_id:new mongoose.Types.ObjectId(event.appointmentId),data:{appointmentId:event.appointmentId}}});
}

export function registerAppointmentNotificationHandler() {
    if (registered) return;
    registered = true;
    appointmentDomainEventService.subscribe(handle);
}

export const DURABLE_APPOINTMENT_REMINDERS_PENDING = true as const;
