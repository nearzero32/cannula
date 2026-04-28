import mongoose, { Schema, model, models } from 'mongoose';
import { IAdminPermissionEnum } from '../interfaces/admin.interface';
import type { IAdmin } from '../interfaces/admin.interface';

export type AdminDocument = mongoose.Document & IAdmin;

const adminSchema = new Schema(
    {
        user_id: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },

        display_name: {
            type: String,
            required: true,
            trim: true,
            minlength: 2,
            maxlength: 120,
        },

        job_title: {
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

        super_admin: {
            type: Boolean,
            default: false,
        },

        is_active: {
            type: Boolean,
            default: true,
        },

        created_by: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        last_action_at: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
        versionKey: false,
    }
);

adminSchema.index({ user_id: 1 });
adminSchema.index({ super_admin: 1, is_active: 1 });

export const Admin = (models.Admin as mongoose.Model<AdminDocument>) || model<AdminDocument>('Admin', adminSchema);
export default Admin;