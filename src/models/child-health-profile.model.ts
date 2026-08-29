import mongoose, { Schema, model, models } from 'mongoose';
import type { IChildHealthProfile } from '../interfaces/health-profile.interface';
import { healthProfileFields } from './health-profile-fields';

export type ChildHealthProfileDocument = mongoose.Document & IChildHealthProfile;

const childHealthProfileSchema = new Schema(
    {
        child_id: {
            type: Schema.Types.ObjectId,
            ref: 'PatientChild',
            required: true,
        },
        ...healthProfileFields,
    },
    { timestamps: true, versionKey: false }
);

childHealthProfileSchema.index({ child_id: 1 }, { unique: true });

const ChildHealthProfile =
    (models.ChildHealthProfile as mongoose.Model<ChildHealthProfileDocument>) ||
    model<ChildHealthProfileDocument>('ChildHealthProfile', childHealthProfileSchema);

export default ChildHealthProfile;
