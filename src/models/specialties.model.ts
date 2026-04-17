import mongoose, { Schema, model, models } from 'mongoose';
import { ISpecialtyStatusEnum } from '../interfaces/specialty.interface';
import type { ISpecialty } from '../interfaces/specialty.interface';

export type SpecialtyDocument = mongoose.Document & ISpecialty;

const specialtySchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      maxlength: 120,
      index: true,
    },

    description: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: null,
    },

    icon: {
      type: String,
      default: null,
    },

    status: {
      type: String,
      enum: Object.values(ISpecialtyStatusEnum),
      default: ISpecialtyStatusEnum.ACTIVE,
      index: true,
    },

    sortOrder: {
      type: Number,
      default: 0,
    },

    createdBy: {
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

specialtySchema.index({ name: 1 }, { unique: true });
specialtySchema.index({ status: 1, sortOrder: 1 });

export const specialties =
  (models.Specialty as mongoose.Model<SpecialtyDocument>) || model<SpecialtyDocument>('specialties', specialtySchema);
export default specialties;