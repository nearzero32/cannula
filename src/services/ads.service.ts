import Ads, { AdsDocument } from '../models/ads.model';
import type { IAds } from '../interfaces/ads.interface';
import type { IAdsStatus } from '../interfaces/ads.interface';
import type { PipelineStage } from 'mongoose';

class AdsService {
    private model = Ads;

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
    }): Promise<{ data: AdsDocument[]; count: number }> {
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
            data: (agg?.data ?? []) as AdsDocument[],
            count: agg?.count?.[0]?.count ?? 0,
        };
    }

    public async getById(id: string): Promise<AdsDocument | null> {
        return await this.model.findById(id).exec();
    }

    public async create(payload: Partial<IAds>): Promise<AdsDocument> {
        return await this.model.create(payload);
    }

    public async update(id: string, payload: Partial<IAds>): Promise<AdsDocument | null> {
        return await this.model.findByIdAndUpdate(id, payload, { new: true }).exec();
    }

    public async updateStatus(id: string, status: IAdsStatus): Promise<AdsDocument | null> {
        return await this.model.findByIdAndUpdate(id, { status }, { new: true }).exec();
    }
}

export default new AdsService();
