import mongoose, { Schema, model, models } from 'mongoose';
import type { IDoctorFavorite } from '../interfaces/doctors-favorite.interface';

export type DoctorFavoriteDocument = mongoose.Document & IDoctorFavorite;

const doctorFavoriteSchema = new Schema(
    {
        patient_id: {
            type: Schema.Types.ObjectId,
            ref: 'Patient',
            required: true,
        },
        doctor_id: {
            type: Schema.Types.ObjectId,
            ref: 'Doctor',
            required: true,
        },
    },
    {
        timestamps: true,
    }
);

doctorFavoriteSchema.index({ patient_id: 1, doctor_id: 1 }, { unique: true });
doctorFavoriteSchema.index({ patient_id: 1, createdAt: -1 });
doctorFavoriteSchema.index({ doctor_id: 1 });

export const DoctorFavorite =
    (models.DoctorFavorite as mongoose.Model<DoctorFavoriteDocument>) ||
    model<DoctorFavoriteDocument>('DoctorFavorite', doctorFavoriteSchema);

export default DoctorFavorite;
