import mongoose, { Schema, model, models } from 'mongoose';
import type { IAds } from '../interfaces/ads.interface';
import { IAdsStatusEnum } from '../interfaces/ads.interface';

export type AdsDocument = mongoose.Document & IAds;

const adsSchema = new Schema<AdsDocument>(
    {
        title: { type: String, default: null },
        description: { type: String, default: null },
        image: { type: String, required: true },
        link: { type: String, default: null },
        clinic_id: { type: Schema.Types.ObjectId, ref: 'Clinic', required: true },
        status: {
            type: String,
            enum: Object.values(IAdsStatusEnum),
            default: IAdsStatusEnum.ACTIVE,
        },
        end_date: { type: Date, default: null },
    },
    { timestamps: true, versionKey: false }
);

adsSchema.index({ clinic_id: 1, status: 1, createdAt: -1 });

export const Ads =
    (models.Ads as mongoose.Model<AdsDocument>) ||
    model<AdsDocument>('Ads', adsSchema);

export default Ads;
