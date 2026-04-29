import AboutUs, { AboutUsDocument } from '../models/about-us.model';
import type { IAboutUs } from '../interfaces/about-us.interface';
import ActivityLogService from './activity-log.service';
import { IActivityLogActionEnum, IActivityLogSourceEnum } from '../interfaces/activity-log.interface';

class AboutUsService {
    private model = AboutUs;
    private activityLog = ActivityLogService;

    public async get(): Promise<AboutUsDocument | null> {
        return await this.model.findOne().exec();
    }

    public async upsert(payload: Partial<IAboutUs>, meta?: { user_id?: string; user_name?: string; user_type?: string; endpoint?: string; source?: string }): Promise<AboutUsDocument> {
        const existing = await this.model.findOne().exec();
        const action = existing ? IActivityLogActionEnum.UPDATE : IActivityLogActionEnum.CREATE;

        if (existing) {
            const oldData = existing.toObject();
            Object.assign(existing, payload);
            const doc = await existing.save();
            try {
                const changed_fields = Object.keys(payload).filter(k => JSON.stringify((oldData as any)[k]) !== JSON.stringify((doc as any)[k]));
                await this.activityLog.logActivity({
                    user_id: meta?.user_id,
                    user_name: meta?.user_name,
                    user_type: meta?.user_type,
                    method: 'PATCH',
                    endpoint: meta?.endpoint || '/about-us',
                    action,
                    collection_name: 'aboutus',
                    document_id: (doc._id as any).toString(),
                    old_data: oldData,
                    new_data: doc.toObject(),
                    changed_fields,
                    request_body: payload,
                    source: meta?.source || IActivityLogSourceEnum.DASHBOARD,
                });
            } catch {}
            return doc;
        }

        const doc = await this.model.create(payload);
        try {
            await this.activityLog.logActivity({
                user_id: meta?.user_id,
                user_name: meta?.user_name,
                user_type: meta?.user_type,
                method: 'POST',
                endpoint: meta?.endpoint || '/about-us',
                action,
                collection_name: 'aboutus',
                document_id: (doc._id as any).toString(),
                new_data: doc.toObject(),
                request_body: payload,
                source: meta?.source || IActivityLogSourceEnum.DASHBOARD,
            });
        } catch {}
        return doc;
    }
}

export default new AboutUsService();
