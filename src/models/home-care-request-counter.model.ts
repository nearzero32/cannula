import mongoose, { model, models, Schema } from 'mongoose';

interface IHomeCareRequestCounter {
    _id: string;
    sequence: number;
}

const homeCareRequestCounterSchema = new Schema<IHomeCareRequestCounter>(
    {
        _id: { type: String, required: true },
        sequence: { type: Number, required: true, default: 0, min: 0 },
    },
    { versionKey: false, collection: 'home_care_request_counters' }
);

const HomeCareRequestCounter =
    (models.HomeCareRequestCounter as mongoose.Model<IHomeCareRequestCounter>) ||
    model<IHomeCareRequestCounter>('HomeCareRequestCounter', homeCareRequestCounterSchema);

export default HomeCareRequestCounter;
