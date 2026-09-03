import type { FilterQuery } from 'mongoose';
import HomeCareCategory, { type HomeCareCategoryDocument } from '../models/home-care-category.model';
import { IHomeCareStatusEnum, type IHomeCareCategory, type IHomeCareStatus } from '../interfaces/home-care.interface';
import { HomeCareValidationError, normalizeHomeCareName, validateDisplayOrder } from './home-care.validation';
import uploadPolicyService from './upload-policy.service'; import {UploadPurposeEnum} from '../constants/upload-policy';

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
            HomeCareCategory.find(filter).sort({ display_order: 1, createdAt: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).exec(),
            HomeCareCategory.countDocuments(filter).exec(),
        ]);
        return { data, count };
    }

    public async listActive(): Promise<HomeCareCategoryDocument[]> {
        return HomeCareCategory.find({ status: IHomeCareStatusEnum.ACTIVE })
            .sort({ display_order: 1, createdAt: 1, _id: 1 })
            .exec();
    }

    public async getById(id: string): Promise<HomeCareCategoryDocument | null> {
        return HomeCareCategory.findById(id).exec();
    }

    public async getActiveById(id: string): Promise<HomeCareCategoryDocument | null> {
        return HomeCareCategory.findOne({ _id: id, status: IHomeCareStatusEnum.ACTIVE }).exec();
    }

    public async create(input: HomeCareCategoryInput): Promise<HomeCareCategoryDocument> {
        const iconAsset=input.icon?await uploadPolicyService.requireReadyReference(input.icon,UploadPurposeEnum.HOME_CARE_CATEGORY_ICON,'HOME_CARE_CATEGORY','000000000000000000000001'):null;
        const imageAsset=input.image?await uploadPolicyService.requireReadyReference(input.image,UploadPurposeEnum.HOME_CARE_CATEGORY_IMAGE,'HOME_CARE_CATEGORY','000000000000000000000001'):null;
        const normalized = normalizeHomeCareName(input.name);
        const displayOrder = input.displayOrder ?? 0;
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
            }); await uploadPolicyService.finalizeReplacement(iconAsset,null,String(created._id),'icon');await uploadPolicyService.finalizeReplacement(imageAsset,null,String(created._id),'image');return created;
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
            return updated;
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
            return updated;
        } catch (error) {
            if (isDuplicateKeyError(error)) {
                throw new HomeCareValidationError('يوجد نوع رعاية منزلية فعال بهذا الاسم', 409);
            }
            throw error;
        }
    }
}

export default new HomeCareCategoryService();
