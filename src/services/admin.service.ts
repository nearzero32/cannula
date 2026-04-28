import Admin, { AdminDocument } from '../models/admins.model';
import type { IAdmin } from '../interfaces/admin.interface';
import type { PipelineStage } from 'mongoose';

class AdminService {
    private model = Admin;

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

    public async create(payload: Partial<IAdmin>): Promise<AdminDocument> {
        return await this.model.create(payload);
    }

    public async update(id: string, payload: Partial<IAdmin>): Promise<AdminDocument | null> {
        return await this.model.findByIdAndUpdate(id, payload, { new: true }).exec();
    }

}

export default new AdminService();
