import ActivityLog, { ActivityLogDocument } from '../models/activity-log.model';
import type { IActivityLog } from '../interfaces/activity-log.interface';
import mongoose, { type PipelineStage } from 'mongoose';

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

    public async logActivity({
        user_id,
        user_name,
        user_type,
        method,
        endpoint,
        action,
        collection_name,
        document_id,
        old_data = null,
        new_data = null,
        changed_fields = [],
        request_body = {},
        response_status = 200,
        ip_address = '',
        source,
    }: {
        user_id?: string | mongoose.Types.ObjectId;
        user_name?: string;
        user_type?: string;
        method: string;
        endpoint: string;
        action: string;
        collection_name: string;
        document_id?: string | mongoose.Types.ObjectId | null;
        old_data?: unknown;
        new_data?: unknown;
        changed_fields?: string[];
        request_body?: unknown;
        response_status?: number;
        ip_address?: string;
        source: string;
    }): Promise<ActivityLogDocument> {
        return await this.model.create({
            user_id: user_id ? new mongoose.Types.ObjectId(user_id) : undefined,
            user_name: user_name || 'unknown',
            user_type: user_type || '',
            method,
            endpoint,
            action,
            collection_name,
            document_id: document_id ? new mongoose.Types.ObjectId(document_id) : null,
            old_data,
            new_data,
            changed_fields,
            request_body,
            response_status,
            ip_address: ip_address || '',
            source,
        });
    }
}

export default new ActivityLogService();
