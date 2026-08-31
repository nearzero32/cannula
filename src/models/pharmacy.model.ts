import mongoose, { model, models, Schema } from 'mongoose';
import { IPharmacyStatusEnum, type IPharmacy } from '../interfaces/pharmacy.interface';
export type PharmacyDocument = mongoose.Document & IPharmacy;
const schema = new Schema({
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 160 },
    display_name: { type: String, trim: true, maxlength: 160, default: null }, logo: { type: String, default: null },
    phone: { type: String, required: true, trim: true, minlength: 7, maxlength: 30 },
    license_number: { type: String, trim: true, maxlength: 100, default: null }, license_verified: { type: Boolean, default: false },
    address: { address_text: { type: String, required: true, trim: true, minlength: 5, maxlength: 500 }, lat: { type: Number, min: -90, max: 90, default: null }, lng: { type: Number, min: -180, max: 180, default: null }, _id: false },
    accepts_prescription_requests: { type: Boolean, default: true },
    status: { type: String, enum: Object.values(IPharmacyStatusEnum), default: IPharmacyStatusEnum.ACTIVE },
    notes_internal: { type: String, trim: true, maxlength: 2000, default: null },
}, { timestamps: true, versionKey: false, collection: 'pharmacies' });
schema.index({ user_id: 1 }, { unique: true }); schema.index({ status: 1, accepts_prescription_requests: 1 });
export default (models.Pharmacy as mongoose.Model<PharmacyDocument>) || model<PharmacyDocument>('Pharmacy', schema);
