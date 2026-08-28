import mongoose, { model, models, Schema } from 'mongoose';
import { IHomeCareStatusEnum, type IHomeCareService } from '../interfaces/home-care.interface';

export type HomeCareServiceDocument = mongoose.Document & IHomeCareService;

const homeCareServiceSchema = new Schema(
    {
        category_id: { type: Schema.Types.ObjectId, ref: 'HomeCareCategory', required: true },
        name: { type: String, required: true, trim: true, maxlength: 160 },
        short_description: { type: String, trim: true, maxlength: 500, default: null },
        description: { type: String, trim: true, maxlength: 3000, default: null },
        image: { type: String, default: null },
        duration_min: {
            type: Number,
            min: 0,
            default: null,
            validate: (value: number | null): boolean => value === null || value === undefined || Number.isInteger(value),
        },
        duration_max: {
            type: Number,
            min: 0,
            default: null,
            validate: {
                validator(this: IHomeCareService, value: number | null): boolean {
                    return value === null || value === undefined || this.duration_min === null ||
                        this.duration_min === undefined || value >= this.duration_min;
                },
                message: 'duration_max must be greater than or equal to duration_min',
            },
        },
        price: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
        status: {
            type: String,
            enum: Object.values(IHomeCareStatusEnum),
            default: IHomeCareStatusEnum.ACTIVE,
        },
        display_order: { type: Number, min: 0, default: 0, validate: Number.isInteger },
        created_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    },
    { timestamps: true, versionKey: false, collection: 'home_care_services' }
);

homeCareServiceSchema.index({ category_id: 1, status: 1, display_order: 1 });

export const HomeCareService =
    (models.HomeCareService as mongoose.Model<HomeCareServiceDocument>) ||
    model<HomeCareServiceDocument>('HomeCareService', homeCareServiceSchema);

export default HomeCareService;
