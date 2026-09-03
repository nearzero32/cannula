import mongoose, { Schema, model, models } from 'mongoose';
import { AppointmentActorTypeEnum, AppointmentBeneficiaryTypeEnum, IAppointmentBookingSourceEnum, IAppointmentPaymentStatusEnum, IAppointmentStatusEnum, type IAppointment } from '../interfaces/appointment.interface';
export type AppointmentDocument = mongoose.Document & IAppointment;
export const APPOINTMENT_BLOCKING_STATUSES = [IAppointmentStatusEnum.PENDING, IAppointmentStatusEnum.CONFIRMED, IAppointmentStatusEnum.CHECKED_IN, IAppointmentStatusEnum.IN_PROGRESS] as const;

const specialtySnapshotSchema = new Schema({ name: { type: String, required: true } }, { _id: false });

const appointmentSchema = new Schema({
    appointment_number: { type: String, required: true, trim: true },
    patient_id: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    beneficiary_type: { type: String, enum: Object.values(AppointmentBeneficiaryTypeEnum), required: true },
    child_id: { type: Schema.Types.ObjectId, ref: 'PatientChild', default: null },
    doctor_id: { type: Schema.Types.ObjectId, ref: 'Doctor', required: true },
    clinic_id: { type: Schema.Types.ObjectId, ref: 'Clinic', required: true },
    specialty_id: { type: Schema.Types.ObjectId, ref: 'Specialty', default: null },
    local_date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    starts_at: { type: Date, required: true }, ends_at: { type: Date, required: true },
    blocked_starts_at: { type: Date, required: true }, blocked_ends_at: { type: Date, required: true },
    status: { type: String, enum: Object.values(IAppointmentStatusEnum), required: true },
    booking_source: { type: String, enum: Object.values(IAppointmentBookingSourceEnum), required: true },
    booked_by_user_id: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reason: { type: String, trim: true, maxlength: 1000, default: null },
    notes_internal: { type: String, trim: true, maxlength: 2000, default: null },
    snapshot: {
        doctor: { display_name: { type: String, required: true }, profile_photo: { type: String, default: null }, _id: false },
        clinic: { name: { type: String, required: true }, address: { type: String, required: true }, _id: false },
        specialty: { type: specialtySnapshotSchema, default: null },
        beneficiary: { type: { type: String, enum: Object.values(AppointmentBeneficiaryTypeEnum), required: true }, display_name: { type: String, required: true }, _id: false },
        pricing: { fee: { type: Number, min: 0, required: true }, currency: { type: String, default: 'IQD' }, _id: false },
        _id: false,
    },
    payment_status: { type: String, enum: Object.values(IAppointmentPaymentStatusEnum), default: IAppointmentPaymentStatusEnum.UNPAID },
    cancellation: {
        reason: { type: String, trim: true, maxlength: 1000, default: null },
        actor_type: { type: String, enum: Object.values(AppointmentActorTypeEnum) },
        actor_user_id: { type: Schema.Types.ObjectId, ref: 'User', default: null }, at: { type: Date }, _id: false,
    },
    rescheduled_from: { type: Schema.Types.ObjectId, ref: 'Appointment', default: null },
    rescheduled_to: { type: Schema.Types.ObjectId, ref: 'Appointment', default: null },
    confirmed_at: { type: Date, default: null }, checked_in_at: { type: Date, default: null },
    started_at: { type: Date, default: null }, completed_at: { type: Date, default: null }, no_show_at: { type: Date, default: null },
    workflow_version: { type: Number, default: 0, min: 0 },
}, { timestamps: true, versionKey: false, autoIndex: false });

appointmentSchema.pre('validate', function () {
    if (this.beneficiary_type === AppointmentBeneficiaryTypeEnum.CHILD && !this.child_id) this.invalidate('child_id', 'child_id is required for CHILD');
    if (this.beneficiary_type === AppointmentBeneficiaryTypeEnum.SELF) this.set('child_id', null);
    if (this.ends_at <= this.starts_at || this.blocked_ends_at <= this.blocked_starts_at) this.invalidate('ends_at', 'invalid appointment interval');
});
appointmentSchema.index({ appointment_number: 1 }, { unique: true });
appointmentSchema.index({ doctor_id: 1, starts_at: 1 });
appointmentSchema.index({ doctor_id: 1, status: 1, starts_at: 1 });
appointmentSchema.index({ clinic_id: 1, starts_at: 1 });
appointmentSchema.index({ patient_id: 1, starts_at: -1 });
appointmentSchema.index({ status: 1, starts_at: 1 });
appointmentSchema.index({ doctor_id: 1, local_date: 1, blocked_starts_at: 1, blocked_ends_at: 1 });

export const Appointment = (models.Appointment as mongoose.Model<AppointmentDocument>) || model<AppointmentDocument>('Appointment', appointmentSchema);
export default Appointment;
