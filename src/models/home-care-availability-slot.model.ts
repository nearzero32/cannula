import mongoose, { model, models, Schema } from 'mongoose';
import { HomeCareWeekdayEnum, IHomeCareStatusEnum, type IHomeCareAvailabilitySlot } from '../interfaces/home-care.interface';

export type HomeCareAvailabilitySlotDocument = mongoose.Document & IHomeCareAvailabilitySlot;

const schema = new Schema<HomeCareAvailabilitySlotDocument>({
    service_id: { type: Schema.Types.ObjectId, ref: 'HomeCareService', required: true, immutable: true },
    day_of_week: { type: String, enum: Object.values(HomeCareWeekdayEnum), required: true, immutable: true },
    time: { type: String, required: true, immutable: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    status: { type: String, enum: Object.values(IHomeCareStatusEnum), default: IHomeCareStatusEnum.ACTIVE },
    display_order: { type: Number, min: 0, default: 1000, validate: Number.isSafeInteger },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    /** Internal CAS counter: serializes request selection against dashboard edits. */
    selection_version: { type: Number, min: 0, default: 0, select: false },
}, { timestamps: true, versionKey: false, collection: 'home_care_availability_slots' });

schema.index(
    { service_id: 1, day_of_week: 1, time: 1 },
    { name: 'home_care_service_weekday_time_unique', unique: true, partialFilterExpression: { day_of_week: { $type: 'string' } } },
);
schema.index(
    { service_id: 1, day_of_week: 1, status: 1, display_order: 1 },
    { name: 'home_care_service_weekday_active_order' },
);

export const HomeCareAvailabilitySlot = (models.HomeCareAvailabilitySlot as mongoose.Model<HomeCareAvailabilitySlotDocument>) || model<HomeCareAvailabilitySlotDocument>('HomeCareAvailabilitySlot', schema);
export default HomeCareAvailabilitySlot;
