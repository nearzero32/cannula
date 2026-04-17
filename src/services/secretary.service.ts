import Secretary, { SecretaryDocument } from '../models/secretary.model';
import type { ISecretary } from '../interfaces/secretary.interface';
import type { PipelineStage } from 'mongoose';

class SecretaryService {
    private model = Secretary;

    public async getPaginated({
        main_match,
        additional_pipeline = [],
        projection = null,
        page = 1,
        limit = 10,
    }: {
        main_match: Record<string, unknown>;
        additional_pipeline?: PipelineStage.FacetPipelineStage[];
        projection?: PipelineStage.Project['$project'] | null;
        page?: number;
        limit?: number;
    }): Promise<{ data: SecretaryDocument[]; count: number }> {
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
            data: (agg?.data ?? []) as SecretaryDocument[],
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
    }): Promise<SecretaryDocument | null> {
        const pipeline: PipelineStage[] = [
            main_match,
            ...additional_pipeline,
            ...(projection ? [{ $project: projection } as PipelineStage.Project] : []),
            { $limit: 1 },
        ];
        const [doc] = await this.model.aggregate(pipeline).exec();
        return (doc as SecretaryDocument) ?? null;
    }

    public async getById(id: string): Promise<SecretaryDocument | null> {
        return await this.model.findById(id).exec();
    }

    public async getByUserId(userId: string): Promise<SecretaryDocument | null> {
        return await this.model.findOne({ userId }).exec();
    }

    public async create(payload: Partial<ISecretary>): Promise<SecretaryDocument> {
        return await this.model.create(payload);
    }

    public async update(id: string, payload: Partial<ISecretary>): Promise<SecretaryDocument | null> {
        return await this.model.findByIdAndUpdate(id, payload, { new: true }).exec();
    }

    public async updateStatus(id: string, status: ISecretary['status']): Promise<SecretaryDocument | null> {
        return await this.model.findByIdAndUpdate(id, { status }, { new: true }).exec();
    }
}

export default new SecretaryService();
