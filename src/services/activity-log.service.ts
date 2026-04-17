import ActivityLog, { ActivityLogDocument } from '../models/activity-log.model';
import type { IActivityLog } from '../interfaces/activity-log.interface';
import type { PipelineStage } from 'mongoose';

class ActivityLogService {
    private model = ActivityLog;

    public async getPaginated({
        main_match,
        additional_pipeline = [],
        projection = null,
        page = 1,
        limit = 20,
    }: {
        main_match: Record<string, unknown>;
        additional_pipeline?: PipelineStage.FacetPipelineStage[];
        projection?: PipelineStage.Project['$project'] | null;
        page?: number;
        limit?: number;
    }): Promise<{ data: ActivityLogDocument[]; count: number }> {
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
            data: (agg?.data ?? []) as ActivityLogDocument[],
            count: agg?.count?.[0]?.count ?? 0,
        };
    }

    public async getById(id: string): Promise<ActivityLogDocument | null> {
        return await this.model.findById(id).exec();
    }

    public async create(payload: Partial<IActivityLog>): Promise<ActivityLogDocument> {
        return await this.model.create(payload);
    }
}

export default new ActivityLogService();
