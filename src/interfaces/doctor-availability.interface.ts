import type mongoose from 'mongoose';
import type { IBaseDocument } from './common.interface';
import type { AppointmentActorType } from './appointment.interface';
export interface AvailabilityPeriod { start_time: string; end_time: string }
export interface IDoctorAvailability extends IBaseDocument {
    doctor_id: mongoose.Types.ObjectId; clinic_id: mongoose.Types.ObjectId; day_of_week: number;
    periods: AvailabilityPeriod[]; is_active: boolean;
}
export const AvailabilityExceptionTypeEnum = { CLOSED: 'CLOSED', CUSTOM_HOURS: 'CUSTOM_HOURS' } as const;
export type AvailabilityExceptionType = (typeof AvailabilityExceptionTypeEnum)[keyof typeof AvailabilityExceptionTypeEnum];
export interface IDoctorAvailabilityException extends IBaseDocument {
    doctor_id: mongoose.Types.ObjectId; clinic_id?: mongoose.Types.ObjectId | null; local_date: string;
    type: AvailabilityExceptionType; periods: AvailabilityPeriod[]; reason?: string | null;
    created_by_user_id?: mongoose.Types.ObjectId | null; created_by_type: AppointmentActorType;
}
