import mongoose, { Schema, model, models } from 'mongoose';
import { IChronicConditionStatusEnum } from '../interfaces/chronic-condition.interface';
import type { IChronicCondition } from '../interfaces/chronic-condition.interface';

export type ChronicConditionDocument = mongoose.Document & IChronicCondition;

const chronicConditionSchema = new Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 120,
        },

        description: {
            type: String,
            trim: true,
            maxlength: 1000,
            default: null,
        },

        status: {
            type: String,
            enum: Object.values(IChronicConditionStatusEnum),
            default: IChronicConditionStatusEnum.ACTIVE,
        },

        created_by: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
    },
    {
        timestamps: true,
        versionKey: false,
    }
);

chronicConditionSchema.index({ name: 1 });
chronicConditionSchema.index({ status: 1 });

export const ChronicCondition =
    (models.ChronicCondition as mongoose.Model<ChronicConditionDocument>) ||
    model<ChronicConditionDocument>('ChronicCondition', chronicConditionSchema);

export default ChronicCondition;
