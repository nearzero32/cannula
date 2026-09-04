import Specialty, { SpecialtyDocument } from '../models/specialties.model';
import type { ISpecialty } from '../interfaces/specialty.interface';
import type { PipelineStage } from 'mongoose';
import mongoose from 'mongoose';
import ActivityLogService from './activity-log.service';
import { IActivityLogActionEnum, IActivityLogSourceEnum } from '../interfaces/activity-log.interface';
import uploadPolicyService from './upload-policy.service'; import {UploadPurposeEnum} from '../constants/upload-policy';
import RedisClient from '../databases/redis';
import { DomainError } from './domain-error';

export const MOBILE_SPECIALTIES_CACHE_TTL_SECONDS = 300;
export const MOBILE_SPECIALTIES_CACHE_PREFIX = 'cache:mobile:specialties:v1';
export const PATIENT_SPECIALTY_SORT = Object.freeze({ sort_order: 1, _id: 1 } as const);
export const mobileSpecialtiesCacheKey = (page: number, limit: number, search: string) => `${MOBILE_SPECIALTIES_CACHE_PREFIX}:page=${page}:limit=${limit}:search=${encodeURIComponent(search)}`;

class SpecialtyService {
    private model = Specialty;
    private activityLog = ActivityLogService;

    public async getPaginated({
        main_match,
        additional_pipeline = [],
        projection,
        page = 1,
        limit = 10,
        sort = { sort_order: 1, createdAt: -1 },
    }: {
        main_match: Record<string, unknown>;
        additional_pipeline?: PipelineStage.FacetPipelineStage[];
        projection?: PipelineStage.Project['$project'] | null;
        page?: number;
        limit?: number;
        sort?: Record<string, 1 | -1>;
    }): Promise<{ data: SpecialtyDocument[]; count: number }> {
        const safePage = Math.max(1, page);
        const safeLimit = Math.min(100, Math.max(1, limit));
        const skip = (safePage - 1) * safeLimit;

        const pipeline: PipelineStage[] = [
            { $match: main_match },
            {
                $facet: {
                    data: [
                        { $sort: sort },
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

    public async invalidateMobileCache() {
        try { await RedisClient.getInstance().deleteByPattern(`${MOBILE_SPECIALTIES_CACHE_PREFIX}:*`); }
        catch { console.warn('Unable to invalidate mobile specialties cache'); }
    }

    public async create(payload: Partial<ISpecialty>, meta?: { user_id?: string; user_name?: string; user_type?: string; endpoint?: string; source?: string }): Promise<SpecialtyDocument> {
        const media=payload.icon?await uploadPolicyService.requireReadyReference(payload.icon,UploadPurposeEnum.SPECIALTY_ICON,'SPECIALTY','000000000000000000000001'):null;
        const doc = await this.model.create(payload);
        await uploadPolicyService.finalizeReplacement(media,null,String(doc._id),'icon');
        await this.invalidateMobileCache();
        try {
            await this.activityLog.logActivity({
                user_id: meta?.user_id,
                user_name: meta?.user_name,
                user_type: meta?.user_type,
                method: 'POST',
                endpoint: meta?.endpoint || '/specialties',
                action: IActivityLogActionEnum.CREATE,
                collection_name: 'specialties',
                document_id: (doc._id as any).toString(),
                new_data: doc.toObject(),
                request_body: payload,
                source: meta?.source || IActivityLogSourceEnum.DASHBOARD,
            });
        } catch {}
        return doc;
    }

    public async update(id: string, payload: Partial<ISpecialty>, meta?: { user_id?: string; user_name?: string; user_type?: string; endpoint?: string; source?: string }): Promise<SpecialtyDocument | null> {
        const oldDoc = await this.model.findById(id).exec();
        const media=payload.icon?await uploadPolicyService.requireReadyReference(payload.icon,UploadPurposeEnum.SPECIALTY_ICON,'SPECIALTY',id):null;
        const doc = await this.model.findByIdAndUpdate(id, payload, { returnDocument: 'after', runValidators: true }).exec();
        if(doc&&payload.icon!==undefined)await uploadPolicyService.finalizeReplacement(media,oldDoc?.icon,id,'icon');
        if (doc) await this.invalidateMobileCache();
        if (doc && oldDoc) {
            try {
                const changed_fields = Object.keys(payload).filter(k => JSON.stringify((oldDoc as any)[k]) !== JSON.stringify((doc as any)[k]));
                await this.activityLog.logActivity({
                    user_id: meta?.user_id,
                    user_name: meta?.user_name,
                    user_type: meta?.user_type,
                    method: 'PATCH',
                    endpoint: meta?.endpoint || `/specialties/${id}`,
                    action: IActivityLogActionEnum.UPDATE,
                    collection_name: 'specialties',
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

    public async updateStatus(id: string, status: ISpecialty['status'], meta?: { user_id?: string; user_name?: string; user_type?: string; endpoint?: string; source?: string }): Promise<SpecialtyDocument | null> {
        const oldDoc = await this.model.findById(id).exec();
        const doc = await this.model.findByIdAndUpdate(id, { status }, { returnDocument: 'after' }).exec();
        if (doc) await this.invalidateMobileCache();
        if (doc && oldDoc) {
            try {
                await this.activityLog.logActivity({
                    user_id: meta?.user_id,
                    user_name: meta?.user_name,
                    user_type: meta?.user_type,
                    method: 'PATCH',
                    endpoint: meta?.endpoint || `/specialties/${id}/status`,
                    action: IActivityLogActionEnum.UPDATE,
                    collection_name: 'specialties',
                    document_id: id,
                    old_data: { status: oldDoc.status },
                    new_data: { status },
                    changed_fields: ['status'],
                    request_body: { status },
                    source: meta?.source || IActivityLogSourceEnum.DASHBOARD,
                });
            } catch {}
        }
        return doc;
    }

    public async reorder(specialtyIds: string[], meta?: { user_id?: string; user_name?: string; user_type?: string; endpoint?: string; source?: string }) {
        if (!specialtyIds.length || specialtyIds.length > 500) throw new DomainError('قائمة التخصصات غير صالحة', 400, 'INVALID_SPECIALTY_ORDER');
        if (specialtyIds.some(id => !mongoose.Types.ObjectId.isValid(id))) throw new DomainError('معرف تخصص غير صالح', 400, 'INVALID_SPECIALTY_ID');
        if (new Set(specialtyIds).size !== specialtyIds.length) throw new DomainError('لا يمكن تكرار التخصص في الترتيب', 400, 'DUPLICATE_SPECIALTY_ID');
        const ids = specialtyIds.map(id => new mongoose.Types.ObjectId(id));
        const session = await this.model.db.startSession();
        let oldOrders: Array<{ _id: mongoose.Types.ObjectId; sort_order?: number }> = [];
        try {
            await session.withTransaction(async () => {
                oldOrders = await this.model.find({ _id: { $in: ids } }).select('_id sort_order').session(session).lean().exec();
                if (oldOrders.length !== specialtyIds.length) throw new DomainError('يوجد تخصص غير موجود في قائمة الترتيب', 404, 'SPECIALTY_NOT_FOUND');
                const result = await this.model.bulkWrite(specialtyIds.map((id, index) => ({ updateOne: { filter: { _id: new mongoose.Types.ObjectId(id) }, update: { $set: { sort_order: (index + 1) * 10 } } } })), { ordered: true, session });
                if (result.matchedCount !== specialtyIds.length) throw new DomainError('تعذر تحديث ترتيب التخصصات', 409, 'SPECIALTY_ORDER_CONFLICT');
            });
        } finally { await session.endSession(); }
        const sortOrders = specialtyIds.map((_, index) => (index + 1) * 10);
        await this.invalidateMobileCache();
        try { await this.activityLog.logActivity({ user_id: meta?.user_id, user_name: meta?.user_name, user_type: meta?.user_type, method: 'PATCH', endpoint: meta?.endpoint || '/specialties/order', action: IActivityLogActionEnum.BULK_UPDATE, collection_name: 'specialties', old_data: oldOrders.map(item => ({ id: String(item._id), sort_order: item.sort_order ?? null })), new_data: specialtyIds.map((id, index) => ({ id, sort_order: sortOrders[index] })), changed_fields: ['sort_order'], request_body: { specialtyIds }, source: meta?.source || IActivityLogSourceEnum.DASHBOARD }); } catch {}
        return { specialtyIds, sortOrders };
    }

}

export default new SpecialtyService();
