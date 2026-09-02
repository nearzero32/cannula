import mongoose, { Schema, model, models } from 'mongoose';
import { AuthEventTypeEnum } from '../interfaces/auth-flow.interface';

const schema = new Schema({
    flow_id: { type: String, default: null }, phone: { type: String, default: '' },
    user_id: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    patient_id: { type: Schema.Types.ObjectId, ref: 'Patient', default: null },
    type: { type: String, enum: Object.values(AuthEventTypeEnum), required: true },
    success: { type: Boolean, required: true }, reason_code: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} }, ip_address: { type: String, default: '' },
    device_id: { type: String, default: null }, device_name: { type: String, default: null }, platform: { type: String, default: null },
    actor_type: { type: String, default: null }, actor_user_id: { type: Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true, versionKey: false });
schema.index({ phone: 1, createdAt: -1 }); schema.index({ user_id: 1, createdAt: -1 });
schema.index({ patient_id: 1, createdAt: -1 }); schema.index({ flow_id: 1, createdAt: 1 });
schema.index({ type: 1, createdAt: -1 });
export type AuthEventDocument = mongoose.InferSchemaType<typeof schema> & mongoose.Document;
export default (models.AuthEvent as mongoose.Model<AuthEventDocument>) || model<AuthEventDocument>('AuthEvent', schema);
