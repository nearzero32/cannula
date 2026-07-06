import Suggestion, { SuggestionDocument } from '../models/suggestions.model';
import type { ISuggestion } from '../interfaces/suggestion.interface';
import type { PipelineStage } from 'mongoose';
import ActivityLogService from './activity-log.service';
import { IActivityLogActionEnum, IActivityLogSourceEnum } from '../interfaces/activity-log.interface';

class SuggestionService {
    private model = Suggestion;
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
    }): Promise<{ data: SuggestionDocument[]; count: number }> {
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
            data: (agg?.data ?? []) as SuggestionDocument[],
            count: agg?.count?.[0]?.count ?? 0,
        };
    }

    public async getById(id: string, include_deleted = false): Promise<SuggestionDocument | null> {
        const filter: Record<string, unknown> = { _id: id };
        if (!include_deleted) filter.is_deleted = false;
        return await this.model.findOne(filter).exec();
    }

    public async create(
        payload: Partial<ISuggestion>,
        meta?: { user_id?: string; user_name?: string; user_type?: string; endpoint?: string; source?: string }
    ): Promise<SuggestionDocument> {
        const doc = await this.model.create(payload);
        try {
            await this.activityLog.logActivity({
                user_id: meta?.user_id,
                user_name: meta?.user_name,
                user_type: meta?.user_type,
                method: 'POST',
                endpoint: meta?.endpoint || '/suggestions',
                action: IActivityLogActionEnum.CREATE,
                collection_name: 'suggestions',
                document_id: (doc._id as { toString(): string }).toString(),
                new_data: doc.toObject(),
                request_body: payload,
                source: meta?.source || IActivityLogSourceEnum.MOBILE,
            });
        } catch {}
        return doc;
    }

    public async softDelete(
        id: string,
        deleted_by: string,
        meta?: { user_id?: string; user_name?: string; user_type?: string; endpoint?: string; source?: string }
    ): Promise<SuggestionDocument | null> {
        const oldDoc = await this.model.findById(id).exec();
        if (!oldDoc || oldDoc.is_deleted) return null;

        const doc = await this.model
            .findByIdAndUpdate(
                id,
                {
                    is_deleted: true,
                    deleted_at: new Date(),
                    deleted_by,
                },
                { returnDocument: 'after' }
            )
            .exec();

        if (doc && oldDoc) {
            try {
                await this.activityLog.logActivity({
                    user_id: meta?.user_id,
                    user_name: meta?.user_name,
                    user_type: meta?.user_type,
                    method: 'PATCH',
                    endpoint: meta?.endpoint || `/suggestions/${id}/delete`,
                    action: IActivityLogActionEnum.DELETE,
                    collection_name: 'suggestions',
                    document_id: id,
                    old_data: oldDoc.toObject(),
                    new_data: doc.toObject(),
                    changed_fields: ['is_deleted', 'deleted_at', 'deleted_by'],
                    source: meta?.source || IActivityLogSourceEnum.DASHBOARD,
                });
            } catch {}
        }

        return doc;
    }

    public async restore(
        id: string,
        meta?: { user_id?: string; user_name?: string; user_type?: string; endpoint?: string; source?: string }
    ): Promise<SuggestionDocument | null> {
        const oldDoc = await this.model.findById(id).exec();
        if (!oldDoc || !oldDoc.is_deleted) return null;

        const doc = await this.model
            .findByIdAndUpdate(
                id,
                {
                    is_deleted: false,
                    deleted_at: null,
                    deleted_by: null,
                },
                { returnDocument: 'after' }
            )
            .exec();

        if (doc && oldDoc) {
            try {
                await this.activityLog.logActivity({
                    user_id: meta?.user_id,
                    user_name: meta?.user_name,
                    user_type: meta?.user_type,
                    method: 'PATCH',
                    endpoint: meta?.endpoint || `/suggestions/${id}/restore`,
                    action: IActivityLogActionEnum.UPDATE,
                    collection_name: 'suggestions',
                    document_id: id,
                    old_data: oldDoc.toObject(),
                    new_data: doc.toObject(),
                    changed_fields: ['is_deleted', 'deleted_at', 'deleted_by'],
                    source: meta?.source || IActivityLogSourceEnum.DASHBOARD,
                });
            } catch {}
        }

        return doc;
    }
}

export default new SuggestionService();
