import mongoose, { Schema, model, models } from 'mongoose';
import { AppointmentActorTypeEnum, AppointmentHistoryEventEnum, IAppointmentStatusEnum } from '../interfaces/appointment.interface';
const schema = new Schema({
    appointment_id: { type: Schema.Types.ObjectId, ref: 'Appointment', required: true }, appointment_number: { type: String, required: true },
    event_type: { type: String, enum: Object.values(AppointmentHistoryEventEnum), required: true },
    from_status: { type: String, enum: [...Object.values(IAppointmentStatusEnum), null], default: null }, to_status: { type: String, enum: [...Object.values(IAppointmentStatusEnum), null], default: null },
    actor_type: { type: String, enum: Object.values(AppointmentActorTypeEnum), required: true }, actor_user_id: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    actor_profile_id: { type: Schema.Types.ObjectId, default: null }, reason: { type: String, maxlength: 1000, default: null }, metadata: { type: Schema.Types.Mixed, default: null },
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false, collection: 'appointment_history' });
schema.index({ appointment_id: 1, createdAt: 1, _id: 1 });
export default models.AppointmentHistory || model('AppointmentHistory', schema);
