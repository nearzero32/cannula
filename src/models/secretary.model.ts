import mongoose, { Schema, model, models } from 'mongoose';
import {
    ISecretaryDefaultPermissions,
    ISecretaryPermissionEnum,
    ISecretaryStatusEnum,
} from '../interfaces/secretary.interface';
import type { ISecretary } from '../interfaces/secretary.interface';

export type SecretaryDocument = mongoose.Document & ISecretary;

const secretarySchema = new Schema(
    {
        user_id: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },

        full_name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 120,
        },

        clinic_id: {
            type: Schema.Types.ObjectId,
            ref: 'Clinic',
        },

        doctor_ids: [
            {
                type: Schema.Types.ObjectId,
                ref: 'Doctor',
            },
        ],

        permissions: {
            type: [String],
            enum: Object.values(ISecretaryPermissionEnum),
            default: ISecretaryDefaultPermissions,
        },

        status: {
            type: String,
            enum: Object.values(ISecretaryStatusEnum),
            default: ISecretaryStatusEnum.ACTIVE,
        },

        created_by: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },

        notes_internal: {
            type: String,
            trim: true,
            maxlength: 2000,
            default: null,
        },
    },
    {
        timestamps: true,
        versionKey: false,
    }
);

secretarySchema.index({ status: 1 });
secretarySchema.index({ clinic_id: 1 });
secretarySchema.index({ doctor_ids: 1 });

export const Secretary =
    (models.Secretary as mongoose.Model<SecretaryDocument>) ||
    model<SecretaryDocument>('Secretary', secretarySchema);
export default Secretary;
