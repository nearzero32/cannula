import mongoose, { model, models, Schema } from 'mongoose';
import {
    HomeCareRequestIdempotencyStatusEnum,
    type IHomeCareRequestIdempotency,
} from '../interfaces/home-care-request-idempotency.interface';

export type HomeCareRequestIdempotencyDocument = mongoose.Document & IHomeCareRequestIdempotency;

const schema = new Schema<HomeCareRequestIdempotencyDocument>({
    patient_id: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, immutable: true },
    idempotency_key: { type: String, required: true, immutable: true, minlength: 36, maxlength: 36 },
    request_hash: { type: String, required: true, immutable: true, minlength: 64, maxlength: 64, select: false },
    status: { type: String, enum: Object.values(HomeCareRequestIdempotencyStatusEnum), required: true },
    request_id: { type: Schema.Types.ObjectId, ref: 'HomeCareRequest', default: null },
    response_status: { type: Number, enum: [201], default: null },
    expires_at: { type: Date, required: true },
}, { timestamps: true, versionKey: false, collection: 'home_care_request_idempotency' });

schema.index({ patient_id: 1, idempotency_key: 1 }, { unique: true });
schema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export const HomeCareRequestIdempotency =
    (models.HomeCareRequestIdempotency as mongoose.Model<HomeCareRequestIdempotencyDocument>) ||
    model<HomeCareRequestIdempotencyDocument>('HomeCareRequestIdempotency', schema);

export default HomeCareRequestIdempotency;
