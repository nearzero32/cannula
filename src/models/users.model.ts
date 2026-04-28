import mongoose, { Schema, model, models } from 'mongoose';
import { IUserRoleEnum, IUserStatusEnum } from '../interfaces/user.interface';
import type { IUser } from '../interfaces/user.interface';

export type UserDocument = mongoose.Document & IUser;

const userSchema = new Schema(
    {
        full_name: {
            type: String,
            required: true,
            trim: true,
            minlength: 2,
            maxlength: 120,
        },

        email: {
            type: String,
            trim: true,
            lowercase: true,
            sparse: true,
        },

        phone: {
            type: String,
            required: true,
            trim: true,
        },

        password_hash: {
            type: String,
            required: true,
            select: false,
        },
        password_show: {
            type: String,
            required: true,
            trim: true,
        },

        role: {
            type: String,
            enum: Object.values(IUserRoleEnum),
            required: true,
        },

        status: {
            type: String,
            enum: Object.values(IUserStatusEnum),
            default: IUserStatusEnum.PENDING,
        },

        is_phone_verified: {
            type: Boolean,
            default: false,
        },

        is_email_verified: {
            type: Boolean,
            default: false,
        },

        last_login_at: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
        versionKey: false,
    }
);

userSchema.index({ role: 1, status: 1 });

export const User = (models.User as mongoose.Model<UserDocument>) || model<UserDocument>('User', userSchema);
export default User;