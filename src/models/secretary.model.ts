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
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            unique: true,
            index: true,
        },

        fullName: {
            type: String,
            required: true,
            trim: true,
            maxlength: 120,
        },

        clinicId: {
            type: Schema.Types.ObjectId,
            ref: 'Clinic',
        },

        doctorIds: [
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
            index: true,
        },

        createdBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },

        notesInternal: {
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
secretarySchema.index({ clinicId: 1 });
secretarySchema.index({ doctorIds: 1 });

export const Secretary =
    (models.Secretary as mongoose.Model<SecretaryDocument>) ||
    model<SecretaryDocument>('Secretary', secretarySchema);
export default Secretary;
