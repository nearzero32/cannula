import AboutUs, { AboutUsDocument } from '../models/about-us.model';
import type { IAboutUs } from '../interfaces/about-us.interface';

class AboutUsService {
    private model = AboutUs;

    public async get(): Promise<AboutUsDocument | null> {
        return await this.model.findOne().exec();
    }

    public async upsert(payload: Partial<IAboutUs>): Promise<AboutUsDocument> {
        const existing = await this.model.findOne().exec();

        if (existing) {
            Object.assign(existing, payload);
            return await existing.save();
        }

        return await this.model.create(payload);
    }
}

export default new AboutUsService();
