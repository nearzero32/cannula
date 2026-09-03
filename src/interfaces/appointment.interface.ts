import type mongoose from 'mongoose';
import type { IBaseDocument } from './common.interface';

export const APPOINTMENT_TIMEZONE = 'Asia/Baghdad' as const;
export const IAppointmentStatusEnum = {
    PENDING: 'pending', CONFIRMED: 'confirmed', CHECKED_IN: 'checked_in', IN_PROGRESS: 'in_progress',
    CANCELLED: 'cancelled', COMPLETED: 'completed', NO_SHOW: 'no_show', RESCHEDULED: 'rescheduled',
} as const;
export type IAppointmentStatus = (typeof IAppointmentStatusEnum)[keyof typeof IAppointmentStatusEnum];
export const IAppointmentBookingSourceEnum = { APP: 'app', ADMIN_PANEL: 'admin_panel', PHONE: 'phone' } as const;
export type IAppointmentBookingSource = (typeof IAppointmentBookingSourceEnum)[keyof typeof IAppointmentBookingSourceEnum];
export const IAppointmentPaymentStatusEnum = { UNPAID: 'unpaid', PAID: 'paid', REFUNDED: 'refunded', PARTIAL: 'partial' } as const;
export type IAppointmentPaymentStatus = (typeof IAppointmentPaymentStatusEnum)[keyof typeof IAppointmentPaymentStatusEnum];
export const AppointmentBeneficiaryTypeEnum = { SELF: 'SELF', CHILD: 'CHILD' } as const;
export type AppointmentBeneficiaryType = (typeof AppointmentBeneficiaryTypeEnum)[keyof typeof AppointmentBeneficiaryTypeEnum];
export const AppointmentActorTypeEnum = { PATIENT: 'PATIENT', DOCTOR: 'DOCTOR', ADMIN: 'ADMIN', SYSTEM: 'SYSTEM' } as const;
export type AppointmentActorType = (typeof AppointmentActorTypeEnum)[keyof typeof AppointmentActorTypeEnum];
export const AppointmentHistoryEventEnum = {
    CREATED: 'CREATED', CONFIRMED: 'CONFIRMED', CANCELLED: 'CANCELLED', RESCHEDULED_FROM: 'RESCHEDULED_FROM',
    RESCHEDULED_TO: 'RESCHEDULED_TO', CHECKED_IN: 'CHECKED_IN', STARTED: 'STARTED', COMPLETED: 'COMPLETED',
    NO_SHOW: 'NO_SHOW', INTERNAL_NOTE_UPDATED: 'INTERNAL_NOTE_UPDATED', PAYMENT_STATUS_CHANGED: 'PAYMENT_STATUS_CHANGED',
} as const;
export type AppointmentHistoryEvent = (typeof AppointmentHistoryEventEnum)[keyof typeof AppointmentHistoryEventEnum];

export interface AppointmentSnapshot {
    doctor: { display_name: string; profile_photo?: string | null };
    clinic: { name: string; address: string };
    specialty?: { name: string } | null;
    beneficiary: { type: AppointmentBeneficiaryType; display_name: string };
    pricing: { fee: number; currency: string };
}
export interface IAppointment extends IBaseDocument {
    appointment_number: string; patient_id: mongoose.Types.ObjectId; beneficiary_type: AppointmentBeneficiaryType;
    child_id?: mongoose.Types.ObjectId | null; doctor_id: mongoose.Types.ObjectId; clinic_id: mongoose.Types.ObjectId;
    specialty_id?: mongoose.Types.ObjectId | null; local_date: string; starts_at: Date; ends_at: Date;
    blocked_starts_at: Date; blocked_ends_at: Date; status: IAppointmentStatus; booking_source: IAppointmentBookingSource;
    booked_by_user_id?: mongoose.Types.ObjectId | null; reason?: string | null; notes_internal?: string | null;
    snapshot: AppointmentSnapshot; payment_status: IAppointmentPaymentStatus;
    cancellation?: { reason?: string | null; actor_type: AppointmentActorType; actor_user_id?: mongoose.Types.ObjectId | null; at: Date } | null;
    rescheduled_from?: mongoose.Types.ObjectId | null; rescheduled_to?: mongoose.Types.ObjectId | null;
    confirmed_at?: Date | null; checked_in_at?: Date | null; started_at?: Date | null; completed_at?: Date | null;
    no_show_at?: Date | null; workflow_version: number;
}
export interface AppointmentActor { type: AppointmentActorType; userId?: string; patientId?: string; doctorId?: string }
