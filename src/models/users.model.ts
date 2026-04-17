import mongoose, { Schema, model, models } from 'mongoose';
import { IUserRoleEnum, IUserStatusEnum } from '../interfaces/user.interface';
import type { IUser } from '../interfaces/user.interface';

export type UserDocument = mongoose.Document & IUser;

const userSchema = new Schema(
    {
        fullName: {
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
            unique: true,
        },

        phone: {
            type: String,
            required: true,
            trim: true,
            unique: true,
        },

        passwordHash: {
            type: String,
            required: true,
            select: false,
        },

        role: {
            type: String,
            enum: Object.values(IUserRoleEnum),
            required: true,
            index: true,
        },

        status: {
            type: String,
            enum: Object.values(IUserStatusEnum),
            default: IUserStatusEnum.PENDING,
            index: true,
        },

        isPhoneVerified: {
            type: Boolean,
            default: false,
        },

        isEmailVerified: {
            type: Boolean,
            default: false,
        },

        lastLoginAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
        versionKey: false,
    }
);

userSchema.index({ phone: 1 }, { unique: true });
userSchema.index({ email: 1 }, { unique: true, sparse: true });
userSchema.index({ role: 1, status: 1 });

export const User = (models.User as mongoose.Model<UserDocument>) || model<UserDocument>('User', userSchema);
export default User;