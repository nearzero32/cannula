import type mongoose from 'mongoose';
import type { IBaseDocument } from './common.interface';

export const INotificationTypeEnum = {
    APPOINTMENT_BOOKED: 'appointment_booked',
    APPOINTMENT_CONFIRMED: 'appointment_confirmed',
    APPOINTMENT_CANCELLED: 'appointment_cancelled',
    APPOINTMENT_REMINDER: 'appointment_reminder',
    APPOINTMENT_COMPLETED: 'appointment_completed',
    APPOINTMENT_NO_SHOW: 'appointment_no_show',
    APPOINTMENT_RESCHEDULED: 'appointment_rescheduled',
    GENERAL: 'general',
} as const;

export type INotificationType =
    (typeof INotificationTypeEnum)[keyof typeof INotificationTypeEnum];

export const INotificationStatusEnum = {
    PENDING: 'pending',
    SCHEDULED: 'scheduled',
    SENT: 'sent',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
} as const;

export type INotificationStatus =
    (typeof INotificationStatusEnum)[keyof typeof INotificationStatusEnum];

export const INotificationRecipientModelEnum = {
    PATIENT: 'Patient',
    DOCTOR: 'Doctor',
    USER: 'User',
} as const;

export type INotificationRecipientModel =
    (typeof INotificationRecipientModelEnum)[keyof typeof INotificationRecipientModelEnum];

export interface INotification extends IBaseDocument {
    recipient_ids: mongoose.Types.ObjectId[];
    recipient_model: INotificationRecipientModel;
    type: INotificationType;
    status: INotificationStatus;
    title: string;
    body: string;
    data?: Record<string, unknown> | null;
    is_read: boolean;
    read_at?: Date | null;
    scheduled_at?: Date | null;
    sent_at?: Date | null;
    failed_reason?: string | null;
    appointment_id?: mongoose.Types.ObjectId | null;
}
