import Specialty, { SpecialtyDocument } from '../models/specialties.model';
import type { ISpecialty } from '../interfaces/specialty.interface';
import type { PipelineStage } from 'mongoose';

class SpecialtyService {
    private model = Specialty;

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
    }): Promise<{ data: SpecialtyDocument[]; count: number }> {
        const safePage = Math.max(1, page);
        const safeLimit = Math.max(1, limit);
        const skip = (safePage - 1) * safeLimit;

        const pipeline: PipelineStage[] = [
            { $match: main_match },
            {
                $facet: {
                    data: [
                        { $sort: { sortOrder: 1, createdAt: -1 } },
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
            data: (agg?.data ?? []) as SpecialtyDocument[],
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
    }): Promise<SpecialtyDocument | null> {
        const pipeline: PipelineStage[] = [
            main_match,
            ...additional_pipeline,
            ...(projection ? [{ $project: projection } as PipelineStage.Project] : []),
            { $limit: 1 },
        ];
        const [doc] = await this.model.aggregate(pipeline).exec();
        return (doc as SpecialtyDocument) ?? null;
    }

    public async getById(id: string): Promise<SpecialtyDocument | null> {
        return await this.model.findById(id).exec();
    }

    public async create(payload: Partial<ISpecialty>): Promise<SpecialtyDocument> {
        return await this.model.create(payload);
    }

    public async update(id: string, payload: Partial<ISpecialty>): Promise<SpecialtyDocument | null> {
        return await this.model.findByIdAndUpdate(id, payload, { new: true }).exec();
    }

}

export default new SpecialtyService();
