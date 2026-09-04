import mongoose, { type FilterQuery } from 'mongoose';
import HomeCareCategory, { type HomeCareCategoryDocument } from '../models/home-care-category.model';
import { IHomeCareStatusEnum, type IHomeCareCategory, type IHomeCareStatus } from '../interfaces/home-care.interface';
import { HomeCareValidationError, normalizeHomeCareName, validateDisplayOrder } from './home-care.validation';
import uploadPolicyService from './upload-policy.service'; import {UploadPurposeEnum} from '../constants/upload-policy';
import RedisClient from '../databases/redis';
import { DomainError } from './domain-error';
import ActivityLogService from './activity-log.service';
import { IActivityLogActionEnum, IActivityLogSourceEnum } from '../interfaces/activity-log.interface';

export const MOBILE_HOME_CARE_CATEGORIES_CACHE_KEY = 'cache:mobile:home-care:categories:v1';
export const MOBILE_HOME_CARE_CACHE_TTL_SECONDS = 300;
export const PATIENT_HOME_CARE_SORT = Object.freeze({ display_order: 1, _id: 1 } as const);

export interface HomeCareCategoryInput {
    name: string;
    description?: string | null;
    icon?: string | null;
    image?: string | null;
    status?: IHomeCareStatus;
    displayOrder?: number;
    createdBy?: string | null;
}

export interface HomeCareCategoryListQuery {
    page?: number;
    limit?: number;
    status?: IHomeCareStatus;
    search?: string;
}

function escapedRegex(value: string): RegExp {
    return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}

function isDuplicateKeyError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}

export class HomeCareCategoryService {
    public async list(query: HomeCareCategoryListQuery): Promise<{ data: HomeCareCategoryDocument[]; count: number }> {
        const page = Math.max(1, query.page ?? 1);
        const limit = Math.min(100, Math.max(1, query.limit ?? 10));
        const filter: FilterQuery<IHomeCareCategory> = {};
        if (query.status) filter.status = query.status;
        if (query.search?.trim()) {
            const search = escapedRegex(query.search.trim());
            filter.$or = [{ name: search }, { description: search }];
        }
        const [data, count] = await Promise.all([
            HomeCareCategory.find(filter).sort(PATIENT_HOME_CARE_SORT).skip((page - 1) * limit).limit(limit).exec(),
            HomeCareCategory.countDocuments(filter).exec(),
        ]);
        return { data, count };
    }

    public async listActive(): Promise<HomeCareCategoryDocument[]> {
        return HomeCareCategory.find({ status: IHomeCareStatusEnum.ACTIVE })
            .sort(PATIENT_HOME_CARE_SORT)
            .exec();
    }

    public async getById(id: string): Promise<HomeCareCategoryDocument | null> {
        return HomeCareCategory.findById(id).exec();
    }

    public async getActiveById(id: string): Promise<HomeCareCategoryDocument | null> {
        return HomeCareCategory.findOne({ _id: id, status: IHomeCareStatusEnum.ACTIVE }).exec();
    }
    public async invalidateMobileCache() { try { await RedisClient.getInstance().deleteByPattern('cache:mobile:home-care:*'); } catch { console.warn('Unable to invalidate mobile home-care cache'); } }

    public async create(input: HomeCareCategoryInput): Promise<HomeCareCategoryDocument> {
        const iconAsset=input.icon?await uploadPolicyService.requireReadyReference(input.icon,UploadPurposeEnum.HOME_CARE_CATEGORY_ICON,'HOME_CARE_CATEGORY','000000000000000000000001'):null;
        const imageAsset=input.image?await uploadPolicyService.requireReadyReference(input.image,UploadPurposeEnum.HOME_CARE_CATEGORY_IMAGE,'HOME_CARE_CATEGORY','000000000000000000000001'):null;
        const normalized = normalizeHomeCareName(input.name);
        const displayOrder = input.displayOrder ?? 1000;
        validateDisplayOrder(displayOrder);
        const status = input.status ?? IHomeCareStatusEnum.ACTIVE;
        if (status === IHomeCareStatusEnum.ACTIVE &&
            await HomeCareCategory.exists({ normalized_name: normalized.normalizedName, status })) {
            throw new HomeCareValidationError('يوجد نوع رعاية منزلية فعال بهذا الاسم', 409);
        }
        try {
            const created=await HomeCareCategory.create({
                name: normalized.name,
                normalized_name: normalized.normalizedName,
                description: input.description ?? null,
                icon: input.icon ?? null,
                image: input.image ?? null,
                status,
                display_order: displayOrder,
                created_by: input.createdBy ?? null,
            }); await uploadPolicyService.finalizeReplacement(iconAsset,null,String(created._id),'icon');await uploadPolicyService.finalizeReplacement(imageAsset,null,String(created._id),'image');await this.invalidateMobileCache();return created;
        } catch (error) {
            if (isDuplicateKeyError(error)) {
                throw new HomeCareValidationError('يوجد نوع رعاية منزلية فعال بهذا الاسم', 409);
            }
            throw error;
        }
    }

    public async update(id: string, input: Partial<HomeCareCategoryInput>): Promise<HomeCareCategoryDocument> {
        const current = await this.getById(id);
        const iconAsset=input.icon?await uploadPolicyService.requireReadyReference(input.icon,UploadPurposeEnum.HOME_CARE_CATEGORY_ICON,'HOME_CARE_CATEGORY',id):null;
        const imageAsset=input.image?await uploadPolicyService.requireReadyReference(input.image,UploadPurposeEnum.HOME_CARE_CATEGORY_IMAGE,'HOME_CARE_CATEGORY',id):null;
        if (!current) throw new HomeCareValidationError('نوع الرعاية المنزلية غير موجود', 404);
        const payload: Record<string, unknown> = {};
        if (input.name !== undefined) {
            const normalized = normalizeHomeCareName(input.name);
            payload.name = normalized.name;
            payload.normalized_name = normalized.normalizedName;
            if (current.status === IHomeCareStatusEnum.ACTIVE && await HomeCareCategory.exists({
                _id: { $ne: id }, normalized_name: normalized.normalizedName, status: IHomeCareStatusEnum.ACTIVE,
            })) {
                throw new HomeCareValidationError('يوجد نوع رعاية منزلية فعال بهذا الاسم', 409);
            }
        }
        if (input.description !== undefined) payload.description = input.description;
        if (input.icon !== undefined) payload.icon = input.icon;
        if (input.image !== undefined) payload.image = input.image;
        if (input.displayOrder !== undefined) {
            validateDisplayOrder(input.displayOrder);
            payload.display_order = input.displayOrder;
        }
        try {
            const updated = await HomeCareCategory.findByIdAndUpdate(id, payload, { new: true, runValidators: true }).exec();
            if (!updated) throw new HomeCareValidationError('نوع الرعاية المنزلية غير موجود', 404);
            if(input.icon!==undefined)await uploadPolicyService.finalizeReplacement(iconAsset,current.icon,id,'icon');if(input.image!==undefined)await uploadPolicyService.finalizeReplacement(imageAsset,current.image,id,'image');
            await this.invalidateMobileCache(); return updated;
        } catch (error) {
            if (isDuplicateKeyError(error)) {
                throw new HomeCareValidationError('يوجد نوع رعاية منزلية فعال بهذا الاسم', 409);
            }
            throw error;
        }
    }

    public async updateStatus(id: string, status: IHomeCareStatus): Promise<HomeCareCategoryDocument> {
        const current = await HomeCareCategory.findById(id).select('+normalized_name').exec();
        if (!current) throw new HomeCareValidationError('نوع الرعاية المنزلية غير موجود', 404);
        if (status === IHomeCareStatusEnum.ACTIVE && await HomeCareCategory.exists({
            _id: { $ne: id }, normalized_name: current.normalized_name, status,
        })) {
            throw new HomeCareValidationError('يوجد نوع رعاية منزلية فعال بهذا الاسم', 409);
        }
        try {
            const updated = await HomeCareCategory.findByIdAndUpdate(id, { status }, { new: true, runValidators: true }).exec();
            if (!updated) throw new HomeCareValidationError('نوع الرعاية المنزلية غير موجود', 404);
            await this.invalidateMobileCache(); return updated;
        } catch (error) {
            if (isDuplicateKeyError(error)) {
                throw new HomeCareValidationError('يوجد نوع رعاية منزلية فعال بهذا الاسم', 409);
            }
            throw error;
        }
    }
    public async reorder(categoryIds: string[], meta?: { user_id?: string; user_name?: string; user_type?: string; endpoint?: string; source?: string }) {
        if (!categoryIds.length || categoryIds.length > 500) throw new DomainError('قائمة أنواع الرعاية المنزلية غير صالحة', 400, 'INVALID_HOME_CARE_CATEGORY_ORDER');
        if (categoryIds.some(id => !mongoose.Types.ObjectId.isValid(id))) throw new DomainError('معرف نوع الرعاية المنزلية غير صالح', 400, 'INVALID_HOME_CARE_CATEGORY_ID');
        if (new Set(categoryIds).size !== categoryIds.length) throw new DomainError('لا يمكن تكرار نوع الرعاية المنزلية في الترتيب', 400, 'DUPLICATE_HOME_CARE_CATEGORY_ID');
        const ids = categoryIds.map(id => new mongoose.Types.ObjectId(id)), session = await HomeCareCategory.db.startSession(); let oldOrders: any[] = [];
        try { await session.withTransaction(async () => { oldOrders = await HomeCareCategory.find({ _id: { $in: ids } }).select('_id display_order').session(session).lean().exec(); if (oldOrders.length !== categoryIds.length) throw new DomainError('يوجد نوع رعاية منزلية غير موجود', 404, 'HOME_CARE_CATEGORY_NOT_FOUND'); const result = await HomeCareCategory.bulkWrite(categoryIds.map((id, index) => ({ updateOne: { filter: { _id: new mongoose.Types.ObjectId(id) }, update: { $set: { display_order: (index + 1) * 10 } } } })), { ordered: true, session }); if (result.matchedCount !== categoryIds.length) throw new DomainError('تعذر تحديث الترتيب', 409, 'HOME_CARE_CATEGORY_ORDER_CONFLICT'); }); } finally { await session.endSession(); }
        const displayOrders = categoryIds.map((_, index) => (index + 1) * 10); await this.invalidateMobileCache(); try { await ActivityLogService.logActivity({ user_id: meta?.user_id, user_name: meta?.user_name, user_type: meta?.user_type, method: 'PATCH', endpoint: meta?.endpoint || '/home-care/categories/order', action: IActivityLogActionEnum.BULK_UPDATE, collection_name: 'home_care_categories', old_data: oldOrders, new_data: categoryIds.map((id, index) => ({ id, display_order: displayOrders[index] })), changed_fields: ['display_order'], request_body: { categoryIds }, source: meta?.source || IActivityLogSourceEnum.DASHBOARD }); } catch {} return { categoryIds, displayOrders };
    }
}

export default new HomeCareCategoryService();
