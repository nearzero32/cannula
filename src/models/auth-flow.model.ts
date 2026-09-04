import mongoose, { Schema, model, models } from 'mongoose';
import { AuthFlowPurposeEnum, AuthFlowStepEnum, type IAuthFlow } from '../interfaces/auth-flow.interface';

export type AuthFlowDocument = mongoose.Document & IAuthFlow;
const schema = new Schema({
    flow_id: { type: String, required: true, unique: true },
    phone: { type: String, required: true, index: true },
    purpose: { type: String, enum: Object.values(AuthFlowPurposeEnum), default: AuthFlowPurposeEnum.REGISTRATION, required: true },
    is_current: { type: Boolean, default: false },
    step: { type: String, enum: Object.values(AuthFlowStepEnum), required: true },
    user_id: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    patient_id: { type: Schema.Types.ObjectId, ref: 'Patient', default: null },
    otp_hash: { type: String, select: false, default: null },
    support_otp_hash: { type: String, select: false, default: null },
    otp_expires_at: { type: Date, default: null }, otp_last_sent_at: { type: Date, default: null }, support_otp_expires_at: { type: Date, default: null },
    otp_verified_at: { type: Date, default: null }, consumed_at: { type: Date, default: null },
    otp_attempts: { type: Number, default: 0 }, resend_count: { type: Number, default: 0 },
    login_attempts: { type: Number, default: 0 }, support_issue_count: { type: Number, default: 0 },
    expires_at: { type: Date, required: true }, ip_address: { type: String, default: '' },
}, { timestamps: true, versionKey: false });
schema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });
schema.index({ phone: 1, createdAt: -1 });
schema.index({ phone: 1, purpose: 1, expires_at: 1 });
schema.index({ phone: 1, purpose: 1, is_current: 1 }, { unique: true, partialFilterExpression: { purpose: AuthFlowPurposeEnum.PIN_RECOVERY, is_current: true } });
export default (models.AuthFlow as mongoose.Model<AuthFlowDocument>) || model<AuthFlowDocument>('AuthFlow', schema);
