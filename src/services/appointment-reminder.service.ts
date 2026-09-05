import type { ClientSession } from 'mongoose';
import Patient from '../models/patients.model';
import Notification from '../models/notifications.model';
import NotificationDelivery from '../models/notification-delivery.model';
import domainNotificationService from './domain-notification.service';
import {
    INotificationCategoryEnum,
    INotificationPrivacyEnum,
    INotificationStatusEnum,
    INotificationTypeEnum,
} from '../interfaces/notification.interface';
import { INotificationDeliveryStatusEnum } from '../interfaces/notification-delivery.interface';
import { toBaghdadLocal } from './appointment-time.service';

export const APPOINTMENT_REMINDER_OFFSETS_MINUTES = [1440, 120] as const;

export interface FutureAppointmentReminder {
    offsetMinutes: number;
    reminderAt: Date;
}

export function getFutureReminderTimes(
    startsAt: Date,
    now: Date,
    offsetsMinutes: readonly number[] = APPOINTMENT_REMINDER_OFFSETS_MINUTES
): FutureAppointmentReminder[] {
    return offsetsMinutes
        .map(offsetMinutes => ({
            offsetMinutes,
            reminderAt: new Date(startsAt.getTime() - offsetMinutes * 60_000),
        }))
        .filter(({ reminderAt }) => reminderAt.getTime() > now.getTime());
}

export function appointmentReminderDedupeKey(
    appointmentId: unknown,
    workflowVersion: number,
    offsetMinutes: number,
    patientUserId: unknown
): string {
    return `appointment:${appointmentId}:${workflowVersion}:reminder:${offsetMinutes}:${patientUserId}`;
}

export function appointmentReminderContent(doctorDisplayName: string, startsAt: Date) {
    const local = toBaghdadLocal(startsAt);
    return {
        title: 'تذكير بالموعد',
        body: `موعدك مع د. ${doctorDisplayName} بتاريخ ${local.date} الساعة ${local.time}`,
    };
}

class AppointmentReminderService {
    async scheduleForConfirmedAppointment(appointment: any, session: ClientSession | null, now = new Date()) {
        const patient = await Patient.findById(appointment.patient_id)
            .select('user_id').session(session).lean().exec();
        if (!patient?.user_id) throw new Error('APPOINTMENT_REMINDER_IDENTITY_MISSING');

        const content = appointmentReminderContent(
            appointment.snapshot.doctor.display_name,
            new Date(appointment.starts_at)
        );
        for (const { offsetMinutes, reminderAt } of getFutureReminderTimes(new Date(appointment.starts_at), now)) {
            await domainNotificationService.targeted({
                userIds: [patient.user_id],
                session: session ?? undefined,
                dedupeKey: appointmentReminderDedupeKey(
                    appointment._id,
                    appointment.workflow_version,
                    offsetMinutes,
                    patient.user_id
                ),
                payload: {
                    category: INotificationCategoryEnum.APPOINTMENTS,
                    privacy: INotificationPrivacyEnum.NORMAL,
                    type: INotificationTypeEnum.APPOINTMENT_REMINDER,
                    ...content,
                    source: { domain: 'appointment', id: appointment._id },
                    target: { type: 'appointment', id: appointment._id },
                    appointment_id: appointment._id,
                    visible_at: reminderAt,
                    scheduled_at: reminderAt,
                },
            });
        }
    }

    async cancelFutureForAppointment(appointmentId: unknown, session: ClientSession | null) {
        const reminders = await Notification.find({
            appointment_id: appointmentId,
            type: INotificationTypeEnum.APPOINTMENT_REMINDER,
            status: { $ne: INotificationStatusEnum.CANCELLED },
        }).select('_id').session(session).lean().exec();
        if (!reminders.length) return;

        const reminderIds = reminders.map(reminder => reminder._id);
        const deliveredIds = new Set((await NotificationDelivery.find({
            notification_id: { $in: reminderIds },
            status: INotificationDeliveryStatusEnum.DELIVERED,
        }).select('notification_id').session(session).lean().exec()).map(row => String(row.notification_id)));
        const cancellableIds = reminderIds.filter(id => !deliveredIds.has(String(id)));
        if (!cancellableIds.length) return;

        await Notification.updateMany(
            { _id: { $in: cancellableIds } },
            { $set: { status: INotificationStatusEnum.CANCELLED } },
            { session: session ?? undefined }
        );
        await NotificationDelivery.updateMany(
            {
                notification_id: { $in: cancellableIds },
                status: { $in: [INotificationDeliveryStatusEnum.PENDING, INotificationDeliveryStatusEnum.FAILED] },
            },
            {
                $set: {
                    status: INotificationDeliveryStatusEnum.CANCELLED,
                    next_attempt_at: null,
                    claim_token: null,
                    lease_expires_at: null,
                    processing_started_at: null,
                },
            },
            { session: session ?? undefined }
        );
    }
}

export default new AppointmentReminderService();
