import AboutUs, { AboutUsDocument } from '../models/about-us.model';
import type { IAboutUs } from '../interfaces/about-us.interface';
import ActivityLogService from './activity-log.service';
import { IActivityLogActionEnum, IActivityLogSourceEnum } from '../interfaces/activity-log.interface';
import uploadPolicyService from './upload-policy.service'; import {UploadPurposeEnum} from '../constants/upload-policy';

class AboutUsService {
    private model = AboutUs;
    private activityLog = ActivityLogService;

    public async get(): Promise<AboutUsDocument | null> {
        return await this.model.findOne().exec();
    }

    public async upsert(payload: Partial<IAboutUs>, meta?: { user_id?: string; user_name?: string; user_type?: string; endpoint?: string; source?: string }): Promise<AboutUsDocument> {
        const existing = await this.model.findOne().exec();
        const media=payload.logo?await uploadPolicyService.requireReadyReference(payload.logo,UploadPurposeEnum.ABOUT_US_LOGO,'ABOUT_US',existing?String(existing._id):'000000000000000000000001'):null;
        const action = existing ? IActivityLogActionEnum.UPDATE : IActivityLogActionEnum.CREATE;

        if (existing) {
            const oldData = existing.toObject();
            Object.assign(existing, payload);
            const doc = await existing.save();
            if(payload.logo!==undefined)await uploadPolicyService.finalizeReplacement(media,oldData.logo,String(doc._id),'logo');
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
        await uploadPolicyService.finalizeReplacement(media,null,String(doc._id),'logo');
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
