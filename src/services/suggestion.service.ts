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

    public async getById(id: string): Promise<SuggestionDocument | null> {
        return await this.model.findById(id).exec();
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
}

export default new SuggestionService();
