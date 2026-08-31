import mongoose, { model, models, Schema } from 'mongoose';
import { INurseGenderEnum, INurseStatusEnum, type INurse } from '../interfaces/nurse.interface';

export type NurseDocument = mongoose.Document & INurse;

const nurseSchema = new Schema({
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    full_name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    gender: { type: String, enum: Object.values(INurseGenderEnum), default: null },
    profile_photo: { type: String, default: null },
    specialty: { type: String, trim: true, maxlength: 160, default: null },
    license_number: { type: String, trim: true, maxlength: 100, default: null },
    license_verified: { type: Boolean, default: false },
    experience_years: { type: Number, min: 0, default: null },
    qualified_service_ids: [{ type: Schema.Types.ObjectId, ref: 'HomeCareService' }],
    status: { type: String, enum: Object.values(INurseStatusEnum), default: INurseStatusEnum.INACTIVE },
    notes_internal: { type: String, trim: true, maxlength: 2000, default: null },
}, { timestamps: true, versionKey: false, collection: 'nurses' });

nurseSchema.index({ user_id: 1 }, { unique: true });
nurseSchema.index({ status: 1 });
nurseSchema.index({ qualified_service_ids: 1, status: 1 });

const Nurse = (models.Nurse as mongoose.Model<NurseDocument>) || model<NurseDocument>('Nurse', nurseSchema);
export default Nurse;
