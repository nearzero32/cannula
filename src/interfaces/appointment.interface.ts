import type mongoose from 'mongoose';
import type { IBaseDocument, IWithNotesInternal } from './common.interface';

export const IAppointmentStatusEnum = {
    PENDING: 'pending',
    CONFIRMED: 'confirmed',
    CANCELLED: 'cancelled',
    COMPLETED: 'completed',
    NO_SHOW: 'no_show',
} as const;

export type IAppointmentStatus = (typeof IAppointmentStatusEnum)[keyof typeof IAppointmentStatusEnum];

export const IAppointmentBookingSourceEnum = {
    APP: 'app',
    ADMIN_PANEL: 'admin_panel',
    PHONE: 'phone',
} as const;

export type IAppointmentBookingSource =
    (typeof IAppointmentBookingSourceEnum)[keyof typeof IAppointmentBookingSourceEnum];

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
    rescheduled_from?: mongoose.Types.ObjectId | null;
}
