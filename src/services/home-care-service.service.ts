import mongoose, { type FilterQuery } from 'mongoose';
import HomeCareCategory from '../models/home-care-category.model';
import HomeCareService, { type HomeCareServiceDocument } from '../models/home-care-service.model';
import { IHomeCareStatusEnum, type IHomeCareService, type IHomeCareStatus } from '../interfaces/home-care.interface';
import { HomeCareValidationError, normalizeHomeCareName, validateHomeCareServiceNumbers } from './home-care.validation';

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
            HomeCareService.find(filter).sort({ display_order: 1, createdAt: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).exec(),
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
        }).sort({ display_order: 1, createdAt: 1, _id: 1 }).exec();
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

    public async create(input: HomeCareServiceInput): Promise<HomeCareServiceDocument> {
        const normalizedName = normalizeHomeCareName(input.name).name;
        const status = input.status ?? IHomeCareStatusEnum.ACTIVE;
        const displayOrder = input.displayOrder ?? 0;
        validateHomeCareServiceNumbers({
            price: input.price,
            durationMin: input.durationMin,
            durationMax: input.durationMax,
            displayOrder,
        });
        await this.ensureCategoryCanContainService(input.categoryId, status);
        return HomeCareService.create({
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
        });
    }

    public async update(id: string, input: Partial<HomeCareServiceInput>): Promise<HomeCareServiceDocument> {
        const current = await this.getById(id);
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
        return updated;
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

