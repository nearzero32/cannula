import mongoose, { Schema, model, models } from 'mongoose';
const schema = new Schema({ _id: { type: String }, sequence: { type: Number, default: 0 } }, { versionKey: false });
export default (models.AppointmentCounter as mongoose.Model<{ _id: string; sequence: number }>) || model('AppointmentCounter', schema);
