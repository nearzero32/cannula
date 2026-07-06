import type mongoose from 'mongoose';
import type { IBaseDocument } from './common.interface';

export interface IDoctorFavorite extends IBaseDocument {
    patient_id: mongoose.Types.ObjectId;
    doctor_id: mongoose.Types.ObjectId;
}
