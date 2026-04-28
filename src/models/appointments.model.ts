import mongoose, { Schema, model, models } from 'mongoose';
import { IAppointmentBookingSourceEnum, IAppointmentStatusEnum } from '../interfaces/appointment.interface';
import type { IAppointment } from '../interfaces/appointment.interface';

export type AppointmentDocument = mongoose.Document & IAppointment;

const appointmentSchema = new Schema(
    {
        appointment_number: {
            type: String,
            required: true,
            trim: true,
        },

        patient_id: {
            type: Schema.Types.ObjectId,
            ref: 'Patient',
            required: true,
        },

        doctor_id: {
            type: Schema.Types.ObjectId,
            ref: 'Doctor',
            required: true,
        },

        clinic_id: {
            type: Schema.Types.ObjectId,
            ref: 'Clinic',
            required: true,
        },

        specialty_id: {
            type: Schema.Types.ObjectId,
            ref: 'Specialty',
            default: null,
        },

        date: {
            type: Date,
            required: true,
        },

        start_time: {
            type: String,
            required: true,
            trim: true,
        },

        end_time: {
            type: String,
            required: true,
            trim: true,
        },

        status: {
            type: String,
            enum: Object.values(IAppointmentStatusEnum),
            default: IAppointmentStatusEnum.PENDING,
        },

        booked_by: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },

        booking_source: {
            type: String,
            enum: Object.values(IAppointmentBookingSourceEnum),
            default: IAppointmentBookingSourceEnum.APP,
        },

        reason: {
            type: String,
            trim: true,
            maxlength: 1000,
            default: null,
        },

        notes_internal: {
            type: String,
            trim: true,
            maxlength: 2000,
            default: null,
        },

        cancel_reason: {
            type: String,
            trim: true,
            maxlength: 1000,
            default: null,
        },

        rescheduled_from: {
            type: Schema.Types.ObjectId,
            ref: 'Appointment',
            default: null,
        },
    },
    {
        timestamps: true,
        versionKey: false,
    }
);

appointmentSchema.index({ doctor_id: 1, date: 1, start_time: 1 });
appointmentSchema.index({ patient_id: 1, date: 1 });
appointmentSchema.index({ clinic_id: 1, date: 1 });
appointmentSchema.index({ status: 1, date: 1 });

export const Appointment =
    (models.Appointment as mongoose.Model<AppointmentDocument>) ||
    model<AppointmentDocument>('Appointment', appointmentSchema);
export default Appointment;