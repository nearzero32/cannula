import mongoose, { Schema, model, models } from 'mongoose';
const schema = new Schema({ _id: { type: String }, revision: { type: Number, default: 0 }, touched_at: { type: Date, required: true } }, { versionKey: false });
export default (models.AppointmentDayLock as mongoose.Model<{ _id: string; revision: number; touched_at: Date }>) || model('AppointmentDayLock', schema);
