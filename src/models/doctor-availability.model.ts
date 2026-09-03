import mongoose, { Schema, model, models } from 'mongoose';
import type { IDoctorAvailability } from '../interfaces/doctor-availability.interface';
export type DoctorAvailabilityDocument = mongoose.Document & IDoctorAvailability;
const periodSchema = new Schema({ start_time: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ }, end_time: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ } }, { _id: false });
const schema = new Schema({
    doctor_id: { type: Schema.Types.ObjectId, ref: 'Doctor', required: true }, clinic_id: { type: Schema.Types.ObjectId, ref: 'Clinic', required: true },
    day_of_week: { type: Number, min: 0, max: 6, required: true }, periods: { type: [periodSchema], default: [] }, is_active: { type: Boolean, default: true },
}, { timestamps: true, versionKey: false });
schema.index({ doctor_id: 1, clinic_id: 1, day_of_week: 1 }, { unique: true });
schema.index({ doctor_id: 1, day_of_week: 1, is_active: 1 });
export default (models.DoctorAvailability as mongoose.Model<DoctorAvailabilityDocument>) || model<DoctorAvailabilityDocument>('DoctorAvailability', schema);
