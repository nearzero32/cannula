import mongoose, { Schema, model, models } from 'mongoose';
import { IAdminPermissionEnum } from '../interfaces/admin.interface';
import type { IAdmin } from '../interfaces/admin.interface';

export type AdminDocument = mongoose.Document & IAdmin;

const adminSchema = new Schema(
    {

        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            unique: true,
            index: true,
        },

        displayName: {
            type: String,
            required: true,
            trim: true,
            minlength: 2,
            maxlength: 120,
        },

        jobTitle: {
            type: String,
            trim: true,
            maxlength: 120,
            default: null,
        },

        permissions: {
            type: [String],
            enum: Object.values(IAdminPermissionEnum),
            default: [],
        },

        superAdmin: {
            type: Boolean,
            default: false,
            index: true,
        },

        isActive: {
            type: Boolean,
            default: true,
            index: true,
        },

        createdBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        lastActionAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
        versionKey: false,
    }
);

adminSchema.index({ userId: 1 }, { unique: true });
adminSchema.index({ superAdmin: 1, isActive: 1 });

export const Admin = (models.Admin as mongoose.Model<AdminDocument>) || model<AdminDocument>('Admin', adminSchema);
export default Admin;