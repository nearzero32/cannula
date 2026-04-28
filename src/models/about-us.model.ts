import mongoose, { Schema, model, models } from 'mongoose';
import type { IAboutUs } from '../interfaces/about-us.interface';

export type AboutUsDocument = mongoose.Document & IAboutUs;

const about_us_schema = new Schema<AboutUsDocument>(
    {
        name: { type: String, required: true },
        logo: { type: String, required: true },
        description: { type: String, default: null },
        address: { type: String, default: null },
        phone: { type: String, default: null },
        website: { type: String, default: null },
        facebook: { type: String, default: null },
        instagram: { type: String, default: null },
    },
    { timestamps: true, versionKey: false }
);

export const AboutUs =
    (models.AboutUs as mongoose.Model<AboutUsDocument>) ||
    model<AboutUsDocument>('AboutUs', about_us_schema);

export default AboutUs;
