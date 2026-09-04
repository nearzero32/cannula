import mongoose, { model, models, Schema } from 'mongoose';
import { IHomeCareStatusEnum, type IHomeCareCategory } from '../interfaces/home-care.interface';

export type HomeCareCategoryDocument = mongoose.Document & IHomeCareCategory;

const homeCareCategorySchema = new Schema(
    {
        name: { type: String, required: true, trim: true, maxlength: 120 },
        normalized_name: { type: String, required: true, select: false },
        description: { type: String, trim: true, maxlength: 1000, default: null },
        icon: { type: String, default: null },
        image: { type: String, default: null },
        status: {
            type: String,
            enum: Object.values(IHomeCareStatusEnum),
            default: IHomeCareStatusEnum.ACTIVE,
        },
        display_order: { type: Number, min: 0, default: 1000, validate: Number.isInteger },
        seed_key: { type: String, default: null, select: false },
        created_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    },
    { timestamps: true, versionKey: false, collection: 'home_care_categories' }
);

homeCareCategorySchema.index({ status: 1, display_order: 1 });
homeCareCategorySchema.index(
    { normalized_name: 1 },
    { unique: true, partialFilterExpression: { status: IHomeCareStatusEnum.ACTIVE } }
);
homeCareCategorySchema.index({ seed_key: 1 }, { unique: true, sparse: true });

export const HomeCareCategory =
    (models.HomeCareCategory as mongoose.Model<HomeCareCategoryDocument>) ||
    model<HomeCareCategoryDocument>('HomeCareCategory', homeCareCategorySchema);

export default HomeCareCategory;

