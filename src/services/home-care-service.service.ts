import mongoose, { type FilterQuery } from 'mongoose';
import HomeCareCategory from '../models/home-care-category.model';
import HomeCareService, { type HomeCareServiceDocument } from '../models/home-care-service.model';
import { IHomeCareStatusEnum, type IHomeCareService, type IHomeCareStatus } from '../interfaces/home-care.interface';
import { HomeCareValidationError, normalizeHomeCareName, validateHomeCareServiceNumbers } from './home-care.validation';
import uploadPolicyService from './upload-policy.service'; import {UploadPurposeEnum} from '../constants/upload-policy';
import RedisClient from '../databases/redis';
import { DomainError } from './domain-error';
import ActivityLogService from './activity-log.service';
import { IActivityLogActionEnum, IActivityLogSourceEnum } from '../interfaces/activity-log.interface';
import { PATIENT_HOME_CARE_SORT } from './home-care-category.service';

export const MOBILE_HOME_CARE_SERVICES_CACHE_PREFIX = 'cache:mobile:home-care:services:v1';
export const mobileHomeCareServicesCacheKey = (categoryId?: string) => `${MOBILE_HOME_CARE_SERVICES_CACHE_PREFIX}:category=${categoryId ?? 'all'}`;

export interface HomeCareServiceInput {
    categoryId: string;
    name: string;
    shortDescription?: string | null;
    description?: string | null;
    image?: string | null;
    durationMin?: number | null;
    durationMax?: number | null;
    price: number;
    status?: IHomeCareStatus;
    displayOrder?: number;
    createdBy?: string | null;
}

export interface HomeCareServiceListQuery {
    page?: number;
    limit?: number;
    categoryId?: string;
    status?: IHomeCareStatus;
    search?: string;
}

function escapedRegex(value: string): RegExp {
    return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}

export class HomeCareServiceService {
    public async list(query: HomeCareServiceListQuery): Promise<{ data: HomeCareServiceDocument[]; count: number }> {
        const page = Math.max(1, query.page ?? 1);
        const limit = Math.min(100, Math.max(1, query.limit ?? 10));
        const filter: FilterQuery<IHomeCareService> = {};
        if (query.categoryId) filter.category_id = new mongoose.Types.ObjectId(query.categoryId);
        if (query.status) filter.status = query.status;
        if (query.search?.trim()) {
            const search = escapedRegex(query.search.trim());
            filter.$or = [{ name: search }, { short_description: search }, { description: search }];
        }
        const [data, count] = await Promise.all([
            HomeCareService.find(filter).sort(PATIENT_HOME_CARE_SORT).skip((page - 1) * limit).limit(limit).exec(),
            HomeCareService.countDocuments(filter).exec(),
        ]);
        return { data, count };
    }

    public async listActive(categoryId?: string): Promise<HomeCareServiceDocument[]> {
        const categoryFilter: Record<string, unknown> = { status: IHomeCareStatusEnum.ACTIVE };
        if (categoryId) categoryFilter._id = categoryId;
        const activeCategoryIds = await HomeCareCategory.find(categoryFilter).distinct('_id').exec();
        if (activeCategoryIds.length === 0) return [];
        return HomeCareService.find({
            category_id: { $in: activeCategoryIds },
            status: IHomeCareStatusEnum.ACTIVE,
        }).sort(PATIENT_HOME_CARE_SORT).exec();
    }

    public async getById(id: string): Promise<HomeCareServiceDocument | null> {
        return HomeCareService.findById(id).exec();
    }

    public async getActiveById(id: string): Promise<HomeCareServiceDocument | null> {
        const service = await HomeCareService.findOne({ _id: id, status: IHomeCareStatusEnum.ACTIVE }).exec();
        if (!service) return null;
        const categoryIsActive = await HomeCareCategory.exists({
            _id: service.category_id,
            status: IHomeCareStatusEnum.ACTIVE,
        });
        return categoryIsActive ? service : null;
    }
    public async invalidateMobileCache() { try { await RedisClient.getInstance().deleteByPattern('cache:mobile:home-care:*'); } catch { console.warn('Unable to invalidate mobile home-care cache'); } }

    public async create(input: HomeCareServiceInput): Promise<HomeCareServiceDocument> {
        const media=input.image?await uploadPolicyService.requireReadyReference(input.image,UploadPurposeEnum.HOME_CARE_SERVICE_IMAGE,'HOME_CARE_SERVICE','000000000000000000000001'):null;
        const normalizedName = normalizeHomeCareName(input.name).name;
        const status = input.status ?? IHomeCareStatusEnum.ACTIVE;
        const displayOrder = input.displayOrder ?? 1000;
        validateHomeCareServiceNumbers({
            price: input.price,
            durationMin: input.durationMin,
            durationMax: input.durationMax,
            displayOrder,
        });
        await this.ensureCategoryCanContainService(input.categoryId, status);
        const created=await HomeCareService.create({
            category_id: new mongoose.Types.ObjectId(input.categoryId),
            name: normalizedName,
            short_description: input.shortDescription ?? null,
            description: input.description ?? null,
            image: input.image ?? null,
            duration_min: input.durationMin ?? null,
            duration_max: input.durationMax ?? null,
            price: input.price,
            status,
            display_order: displayOrder,
            created_by: input.createdBy ?? null,
        });await uploadPolicyService.finalizeReplacement(media,null,String(created._id),'image');await this.invalidateMobileCache();return created;
    }

    public async update(id: string, input: Partial<HomeCareServiceInput>): Promise<HomeCareServiceDocument> {
        const current = await this.getById(id);
        const media=input.image?await uploadPolicyService.requireReadyReference(input.image,UploadPurposeEnum.HOME_CARE_SERVICE_IMAGE,'HOME_CARE_SERVICE',id):null;
        if (!current) throw new HomeCareValidationError('الخدمة غير موجودة', 404);
        const categoryId = input.categoryId ?? current.category_id.toString();
        const status = current.status;
        const price = input.price ?? current.price;
        const durationMin = input.durationMin !== undefined ? input.durationMin : current.duration_min;
        const durationMax = input.durationMax !== undefined ? input.durationMax : current.duration_max;
        const displayOrder = input.displayOrder ?? current.display_order;
        validateHomeCareServiceNumbers({ price, durationMin, durationMax, displayOrder });
        await this.ensureCategoryCanContainService(categoryId, status);

        const payload: Record<string, unknown> = {};
        if (input.categoryId !== undefined) payload.category_id = new mongoose.Types.ObjectId(input.categoryId);
        if (input.name !== undefined) payload.name = normalizeHomeCareName(input.name).name;
        if (input.shortDescription !== undefined) payload.short_description = input.shortDescription;
        if (input.description !== undefined) payload.description = input.description;
        if (input.image !== undefined) payload.image = input.image;
        if (input.durationMin !== undefined) payload.duration_min = input.durationMin;
        if (input.durationMax !== undefined) payload.duration_max = input.durationMax;
        if (input.price !== undefined) payload.price = input.price;
        if (input.displayOrder !== undefined) payload.display_order = input.displayOrder;

        const updated = await HomeCareService.findByIdAndUpdate(id, payload, { new: true, runValidators: true }).exec();
        if (!updated) throw new HomeCareValidationError('الخدمة غير موجودة', 404);
        if(input.image!==undefined)await uploadPolicyService.finalizeReplacement(media,current.image,id,'image'); await this.invalidateMobileCache();
        await this.invalidateMobileCache(); return updated;
    }
    public async reorder(serviceIds: string[], meta?: { user_id?: string; user_name?: string; user_type?: string; endpoint?: string; source?: string }) {
        if (!serviceIds.length || serviceIds.length > 500) throw new DomainError('قائمة خدمات الرعاية المنزلية غير صالحة', 400, 'INVALID_HOME_CARE_SERVICE_ORDER');
        if (serviceIds.some(id => !mongoose.Types.ObjectId.isValid(id))) throw new DomainError('معرف خدمة غير صالح', 400, 'INVALID_HOME_CARE_SERVICE_ID');
        if (new Set(serviceIds).size !== serviceIds.length) throw new DomainError('لا يمكن تكرار الخدمة في الترتيب', 400, 'DUPLICATE_HOME_CARE_SERVICE_ID');
        const ids = serviceIds.map(id => new mongoose.Types.ObjectId(id)), session = HomeCareService.db.startSession ? await HomeCareService.db.startSession() : null; let oldOrders: any[] = [];
        try { if (!session) throw new DomainError('تعذر تحديث الترتيب', 409, 'HOME_CARE_SERVICE_ORDER_CONFLICT'); await session.withTransaction(async () => { oldOrders = await HomeCareService.find({ _id: { $in: ids } }).select('_id display_order').session(session).lean().exec(); if (oldOrders.length !== serviceIds.length) throw new DomainError('يوجد خدمة غير موجودة', 404, 'HOME_CARE_SERVICE_NOT_FOUND'); const result = await HomeCareService.bulkWrite(serviceIds.map((id, index) => ({ updateOne: { filter: { _id: new mongoose.Types.ObjectId(id) }, update: { $set: { display_order: (index + 1) * 10 } } } })), { ordered: true, session }); if (result.matchedCount !== serviceIds.length) throw new DomainError('تعذر تحديث الترتيب', 409, 'HOME_CARE_SERVICE_ORDER_CONFLICT'); }); } finally { if (session) await session.endSession(); }
        const displayOrders = serviceIds.map((_, index) => (index + 1) * 10); await this.invalidateMobileCache(); try { await ActivityLogService.logActivity({ user_id: meta?.user_id, user_name: meta?.user_name, user_type: meta?.user_type, method: 'PATCH', endpoint: meta?.endpoint || '/home-care/services/order', action: IActivityLogActionEnum.BULK_UPDATE, collection_name: 'home_care_services', old_data: oldOrders, new_data: serviceIds.map((id, index) => ({ id, display_order: displayOrders[index] })), changed_fields: ['display_order'], request_body: { serviceIds }, source: meta?.source || IActivityLogSourceEnum.DASHBOARD }); } catch {} return { serviceIds, displayOrders };
    }

    public async updateStatus(id: string, status: IHomeCareStatus): Promise<HomeCareServiceDocument> {
        const current = await this.getById(id);
        if (!current) throw new HomeCareValidationError('الخدمة غير موجودة', 404);
        await this.ensureCategoryCanContainService(current.category_id.toString(), status);
        const updated = await HomeCareService.findByIdAndUpdate(id, { status }, { new: true, runValidators: true }).exec();
        if (!updated) throw new HomeCareValidationError('الخدمة غير موجودة', 404);
        return updated;
    }

    private async ensureCategoryCanContainService(categoryId: string, serviceStatus: IHomeCareStatus): Promise<void> {
        const category = await HomeCareCategory.findById(categoryId).select({ status: 1 }).lean();
        if (!category) throw new HomeCareValidationError('نوع الرعاية المنزلية غير موجود', 400);
        if (serviceStatus === IHomeCareStatusEnum.ACTIVE && category.status !== IHomeCareStatusEnum.ACTIVE) {
            throw new HomeCareValidationError('لا يمكن إضافة أو تفعيل خدمة ضمن نوع رعاية منزلية غير فعال', 400);
        }
    }
}

export default new HomeCareServiceService();
