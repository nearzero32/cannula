import mongoose, { Schema, model, models } from 'mongoose';
import { IClinicStatusEnum } from '../interfaces/clinic.interface';
import type { IClinic } from '../interfaces/clinic.interface';

export type ClinicDocument = mongoose.Document & IClinic;

const clinicSchema = new Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 150,
        },

        description: {
            type: String,
            trim: true,
            maxlength: 2000,
            default: null,
        },

        address: {
            type: String,
            required: true,
            trim: true,
            maxlength: 300,
        },

        icon: {
            type: String,
            default: null,
        },

        map_location: {
            lat: { type: Number, default: null },
            lng: { type: Number, default: null },
        },

        status: {
            type: String,
            enum: Object.values(IClinicStatusEnum),
            default: IClinicStatusEnum.ACTIVE,
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

clinicSchema.index({ name: 1 });
clinicSchema.index({ status: 1 });

export const Clinic = (models.Clinic as mongoose.Model<ClinicDocument>) || model<ClinicDocument>('Clinic', clinicSchema);
export default Clinic;