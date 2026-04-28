import User, { UserDocument } from '../models/users.model';
import type { IUser } from '../interfaces/user.interface';
import type { PipelineStage } from 'mongoose';

class UserService {
    private model = User;

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
    }): Promise<{ data: UserDocument[]; count: number }> {
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
            data: (agg?.data ?? []) as UserDocument[],
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
    }): Promise<UserDocument | null> {
        const pipeline: PipelineStage[] = [
            main_match,
            ...additional_pipeline,
            ...(projection ? [{ $project: projection } as PipelineStage.Project] : []),
            { $limit: 1 },
        ];
        const [doc] = await this.model.aggregate(pipeline).exec();
        return (doc as UserDocument) ?? null;
    }

    public async getById(id: string): Promise<UserDocument | null> {
        return await this.model.findById(id).exec();
    }

    // passwordHash has select:false — querying by it still works; it's just excluded from output
    public async findByCredentials({
        phone,
        password_hash,
        roles,
    }: {
        phone: string;
        password_hash: string;
        roles: string[];
    }): Promise<UserDocument | null> {
        return await this.model.findOne({ phone, password_hash, role: { $in: roles } }).exec();
    }

    public async create(payload: Partial<IUser>): Promise<UserDocument> {
        return await this.model.create(payload);
    }

    public async update(id: string, payload: Partial<IUser>): Promise<UserDocument | null> {
        return await this.model.findByIdAndUpdate(id, payload, { new: true }).exec();
    }

}

export default new UserService();
