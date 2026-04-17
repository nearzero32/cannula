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
    appointmentNumber: string;
    patientId: mongoose.Types.ObjectId;
    doctorId: mongoose.Types.ObjectId;
    clinicId: mongoose.Types.ObjectId;
    specialtyId?: mongoose.Types.ObjectId | null;
    date: Date;
    startTime: string;
    endTime: string;
    status: IAppointmentStatus;
    bookedBy?: mongoose.Types.ObjectId | null;
    bookingSource: IAppointmentBookingSource;
    reason?: string | null;
    cancelReason?: string | null;
    rescheduledFrom?: mongoose.Types.ObjectId | null;
}
