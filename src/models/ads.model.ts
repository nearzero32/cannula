import mongoose, { Schema, model, models } from 'mongoose';
import type { IAds } from '../interfaces/ads.interface';
import { IAdsStatusEnum } from '../interfaces/ads.interface';

export type AdsDocument = mongoose.Document & IAds;

const adsSchema = new Schema<AdsDocument>(
    {
        title: {
            type: String,
            default: null
        },
        description: {
            type: String,
            default: null
        },
        image: {
            type: String,
            required: true
        },
        status: {
            type: String,
            enum: Object.values(IAdsStatusEnum),
            default: IAdsStatusEnum.ACTIVE,
        },


        sort_order: { type: Number, required: true, default: 1000, min: 0, validate: { validator: Number.isInteger, message: 'sort_order must be an integer' } },
        start_date: { type: Date, default: null },
        end_date: {
            type: Date,
            default: null,
            validate: {
                validator(this: AdsDocument, value: Date | null) {
                    return !value || !this.start_date || this.start_date <= value;
                },
                message: 'start_date must be before or equal to end_date',
            },
        },
    },
    { timestamps: true, versionKey: false }
);

adsSchema.index({ status: 1, sort_order: 1, _id: 1 });

export const Ads =
    (models.Ads as mongoose.Model<AdsDocument>) ||
    model<AdsDocument>('Ads', adsSchema);

export default Ads;
