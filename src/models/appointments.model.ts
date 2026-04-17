import mongoose, { Schema, model, models } from 'mongoose';
import { IAppointmentBookingSourceEnum, IAppointmentStatusEnum } from '../interfaces/appointment.interface';
import type { IAppointment } from '../interfaces/appointment.interface';

export type AppointmentDocument = mongoose.Document & IAppointment;

const appointmentSchema = new Schema(
    {
        appointmentNumber: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            index: true,
        },

        patientId: {
            type: Schema.Types.ObjectId,
            ref: 'Patient',
            required: true,
            index: true,
        },

        doctorId: {
            type: Schema.Types.ObjectId,
            ref: 'Doctor',
            required: true,
            index: true,
        },

        clinicId: {
            type: Schema.Types.ObjectId,
            ref: 'Clinic',
            required: true,
            index: true,
        },

        specialtyId: {
            type: Schema.Types.ObjectId,
            ref: 'Specialty',
            default: null,
            index: true,
        },

        date: {
            type: Date,
            required: true,
            index: true,
        },

        startTime: {
            type: String,
            required: true,
            trim: true,
        },

        endTime: {
            type: String,
            required: true,
            trim: true,
        },

        status: {
            type: String,
            enum: Object.values(IAppointmentStatusEnum),
            default: IAppointmentStatusEnum.PENDING,
            index: true,
        },

        bookedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },

        bookingSource: {
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

        notesInternal: {
            type: String,
            trim: true,
            maxlength: 2000,
            default: null,
        },

        cancelReason: {
            type: String,
            trim: true,
            maxlength: 1000,
            default: null,
        },

        rescheduledFrom: {
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

appointmentSchema.index({ doctorId: 1, date: 1, startTime: 1 });
appointmentSchema.index({ patientId: 1, date: 1 });
appointmentSchema.index({ clinicId: 1, date: 1 });
appointmentSchema.index({ status: 1, date: 1 });

export const Appointment =
    (models.Appointment as mongoose.Model<AppointmentDocument>) ||
    model<AppointmentDocument>('Appointment', appointmentSchema);
export default Appointment;