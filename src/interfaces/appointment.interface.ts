import type mongoose from 'mongoose';
import type { IBaseDocument, IWithNotesInternal } from './common.interface';

export const IAppointmentStatusEnum = {
    PENDING: 'pending',
    CONFIRMED: 'confirmed',
    CHECKED_IN: 'checked_in',
    IN_PROGRESS: 'in_progress',
    CANCELLED: 'cancelled',
    COMPLETED: 'completed',
    NO_SHOW: 'no_show',
    RESCHEDULED: 'rescheduled',
} as const;

export type IAppointmentStatus = (typeof IAppointmentStatusEnum)[keyof typeof IAppointmentStatusEnum];

export const IAppointmentBookingSourceEnum = {
    APP: 'app',
    ADMIN_PANEL: 'admin_panel',
    PHONE: 'phone',
} as const;

export type IAppointmentBookingSource =
    (typeof IAppointmentBookingSourceEnum)[keyof typeof IAppointmentBookingSourceEnum];

export const IAppointmentPaymentStatusEnum = {
    UNPAID: 'unpaid',
    PAID: 'paid',
    REFUNDED: 'refunded',
    PARTIAL: 'partial',
} as const;

export type IAppointmentPaymentStatus =
    (typeof IAppointmentPaymentStatusEnum)[keyof typeof IAppointmentPaymentStatusEnum];


export const IAppointmentCancelledByModelEnum = {
    PATIENT: 'Patient',
    DOCTOR: 'Doctor',
    USER: 'User',
} as const;

export type IAppointmentCancelledByModel =
    (typeof IAppointmentCancelledByModelEnum)[keyof typeof IAppointmentCancelledByModelEnum];

export interface IAppointment extends IBaseDocument, IWithNotesInternal {
    appointment_number: string;
    patient_id: mongoose.Types.ObjectId;
    doctor_id: mongoose.Types.ObjectId;
    clinic_id: mongoose.Types.ObjectId;
    specialty_id?: mongoose.Types.ObjectId | null;
    date: Date;
    start_time: string;
    end_time: string;
    status: IAppointmentStatus;
    booked_by?: mongoose.Types.ObjectId | null;
    booking_source: IAppointmentBookingSource;
    reason?: string | null;
    cancel_reason?: string | null;
    cancelled_by?: mongoose.Types.ObjectId | null;
    cancelled_by_model?: IAppointmentCancelledByModel | null;
    cancelled_at?: Date | null;
    rescheduled_from?: mongoose.Types.ObjectId | null;
    rescheduled_to?: mongoose.Types.ObjectId | null;
    payment_status: IAppointmentPaymentStatus;
    checked_in_at?: Date | null;
    completed_at?: Date | null;
    appointment_fee: number;
}
