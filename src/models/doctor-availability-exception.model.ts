import mongoose, { Schema, model, models } from 'mongoose';
import { AppointmentActorTypeEnum } from '../interfaces/appointment.interface';
import { AvailabilityExceptionTypeEnum, type IDoctorAvailabilityException } from '../interfaces/doctor-availability.interface';
export type DoctorAvailabilityExceptionDocument = mongoose.Document & IDoctorAvailabilityException;
const periodSchema = new Schema({ start_time: { type: String, required: true }, end_time: { type: String, required: true } }, { _id: false });
const schema = new Schema({
    doctor_id: { type: Schema.Types.ObjectId, ref: 'Doctor', required: true }, clinic_id: { type: Schema.Types.ObjectId, ref: 'Clinic', default: null },
    local_date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ }, type: { type: String, enum: Object.values(AvailabilityExceptionTypeEnum), required: true },
    periods: { type: [periodSchema], default: [] }, reason: { type: String, trim: true, maxlength: 1000, default: null },
    created_by_user_id: { type: Schema.Types.ObjectId, ref: 'User', default: null }, created_by_type: { type: String, enum: Object.values(AppointmentActorTypeEnum), required: true },
}, { timestamps: true, versionKey: false });
schema.index({ doctor_id: 1, clinic_id: 1, local_date: 1 }, { unique: true });
schema.index({ doctor_id: 1, local_date: 1 });
export default (models.DoctorAvailabilityException as mongoose.Model<DoctorAvailabilityExceptionDocument>) || model<DoctorAvailabilityExceptionDocument>('DoctorAvailabilityException', schema);
