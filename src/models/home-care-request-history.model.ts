import mongoose, { model, models, Schema } from 'mongoose';
import { HomeCareHistoryActorTypeEnum, HomeCareHistoryEventEnum, type IHomeCareRequestHistory } from '../interfaces/home-care-request-history.interface';

export type HomeCareRequestHistoryDocument = mongoose.Document & IHomeCareRequestHistory;

const historySchema = new Schema({
    request_id: { type: Schema.Types.ObjectId, ref: 'HomeCareRequest', required: true },
    request_number: { type: String, required: true, trim: true },
    event_type: { type: String, enum: Object.values(HomeCareHistoryEventEnum), required: true },
    actor: {
        type: { type: String, enum: Object.values(HomeCareHistoryActorTypeEnum), required: true },
        user_id: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        nurse_id: { type: Schema.Types.ObjectId, ref: 'Nurse', default: null },
        _id: false,
    },
    from_status: { type: String, default: null }, to_status: { type: String, default: null },
    from_nurse_id: { type: Schema.Types.ObjectId, ref: 'Nurse', default: null },
    to_nurse_id: { type: Schema.Types.ObjectId, ref: 'Nurse', default: null },
    dispatch_mode: { type: String, default: null },
    reason: { type: String, trim: true, maxlength: 1000, default: null },
    metadata: { type: Schema.Types.Mixed, default: null },
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false, collection: 'home_care_request_history', bufferCommands: false });

historySchema.index({ request_id: 1, createdAt: 1 });

const HomeCareRequestHistory = (models.HomeCareRequestHistory as mongoose.Model<HomeCareRequestHistoryDocument>) ||
    model<HomeCareRequestHistoryDocument>('HomeCareRequestHistory', historySchema);
export default HomeCareRequestHistory;
