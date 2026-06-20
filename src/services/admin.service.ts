import Admin, { AdminDocument } from '../models/admins.model';
import type { IAdmin } from '../interfaces/admin.interface';
import type { PipelineStage } from 'mongoose';
import ActivityLogService from './activity-log.service';
import { IActivityLogActionEnum, IActivityLogSourceEnum } from '../interfaces/activity-log.interface';

class AdminService {
    private model = Admin;
    private activityLog = ActivityLogService;

    public async getPaginated({
        main_match,
        additional_pipeline = [],
        projection,
        page = 1,
        limit = 10,
    }: {
        main_match: Record<string, unknown>;
        additional_pipeline?: PipelineStage.FacetPipelineStage[];
        projection?: PipelineStage.Project['$project'] | null;
        page?: number;
        limit?: number;
    }): Promise<{ data: AdminDocument[]; count: number }> {
        const safePage = Math.max(1, page);
        const safeLimit = Math.max(1, limit);
        const skip = (safePage - 1) * safeLimit;

        const pipeline: PipelineStage[] = [
            { $match: main_match },
            {
                $facet: {
                    data: [
                        { $sort: { createdAt: -1 } },
                        { $skip: skip },
                        { $limit: safeLimit },
                        ...additional_pipeline,
                        ...(projection ? [{ $project: projection } as PipelineStage.Project] : []),
                    ],
                    count: [{ $count: 'count' }],
                },
            },
        ];

        const [agg] = await this.model.aggregate(pipeline).exec();
        return {
            data: (agg?.data ?? []) as AdminDocument[],
            count: agg?.count?.[0]?.count ?? 0,
        };
    }

    public async getOneBy({
        main_match = { $match: {} },
        additional_pipeline = [],
        projection = null,
    }: {
        main_match?: PipelineStage.FacetPipelineStage;
        additional_pipeline?: PipelineStage.FacetPipelineStage[];
        projection?: PipelineStage.Project['$project'] | null;
    }): Promise<AdminDocument | null> {
        const pipeline: PipelineStage[] = [
            main_match,
            ...additional_pipeline,
            ...(projection ? [{ $project: projection } as PipelineStage.Project] : []),
            { $limit: 1 },
        ];
        const [doc] = await this.model.aggregate(pipeline).exec();
        return (doc as AdminDocument) ?? null;
    }

    public async getById(id: string): Promise<AdminDocument | null> {
        return await this.model.findById(id).exec();
    }

    public async getByUserId(user_id: string): Promise<AdminDocument | null> {
        return await this.model.findOne({ user_id }).exec();
    }

    public async create(payload: Partial<IAdmin>, meta?: { user_id?: string; user_name?: string; user_type?: string; endpoint?: string; source?: string }): Promise<AdminDocument> {
        const doc = await this.model.create(payload);
        try {
            await this.activityLog.logActivity({
                user_id: meta?.user_id,
                user_name: meta?.user_name,
                user_type: meta?.user_type,
                method: 'POST',
                endpoint: meta?.endpoint || '/admins',
                action: IActivityLogActionEnum.CREATE,
                collection_name: 'admins',
                document_id: (doc._id as any).toString(),
                new_data: doc.toObject(),
                request_body: payload,
                source: meta?.source || IActivityLogSourceEnum.DASHBOARD,
            });
        } catch {}
        return doc;
    }

    public async update(id: string, payload: Partial<IAdmin>, meta?: { user_id?: string; user_name?: string; user_type?: string; endpoint?: string; source?: string }): Promise<AdminDocument | null> {
        const oldDoc = await this.model.findById(id).exec();
        const doc = await this.model.findByIdAndUpdate(id, payload, { returnDocument: 'after' }).exec();
        if (doc && oldDoc) {
            try {
                const changed_fields = Object.keys(payload).filter(k => JSON.stringify((oldDoc as any)[k]) !== JSON.stringify((doc as any)[k]));
                await this.activityLog.logActivity({
                    user_id: meta?.user_id,
                    user_name: meta?.user_name,
                    user_type: meta?.user_type,
                    method: 'PATCH',
                    endpoint: meta?.endpoint || `/admins/${id}`,
                    action: IActivityLogActionEnum.UPDATE,
                    collection_name: 'admins',
                    document_id: id,
                    old_data: oldDoc.toObject(),
                    new_data: doc.toObject(),
                    changed_fields,
                    request_body: payload,
                    source: meta?.source || IActivityLogSourceEnum.DASHBOARD,
                });
            } catch {}
        }
        return doc;
    }

}

export default new AdminService();
