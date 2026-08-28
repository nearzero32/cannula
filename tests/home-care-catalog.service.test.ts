import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import mongoose from 'mongoose';
import HomeCareCategory from '../src/models/home-care-category.model';
import HomeCareService from '../src/models/home-care-service.model';
import { HomeCareCategoryService } from '../src/services/home-care-category.service';
import { HomeCareServiceService } from '../src/services/home-care-service.service';
import { IHomeCareStatusEnum } from '../src/interfaces/home-care.interface';

afterEach(() => mock.restore());

describe('Home Care category service', () => {
    test('creates a trimmed category and preserves dashboard ordering', async () => {
        spyOn(HomeCareCategory, 'exists').mockResolvedValue(null);
        const create = spyOn(HomeCareCategory, 'create').mockImplementation(async (payload) => payload as never);
        const result = await new HomeCareCategoryService().create({ name: '  تمريض  ', displayOrder: 4 });
        expect(create).toHaveBeenCalledTimes(1);
        expect(result.name).toBe('تمريض');
        expect(result.display_order).toBe(4);
    });

    test('prevents duplicate active category names', async () => {
        spyOn(HomeCareCategory, 'exists').mockResolvedValue({ _id: new mongoose.Types.ObjectId() } as never);
        await expect(new HomeCareCategoryService().create({ name: 'تمريض' }))
            .rejects.toThrow('يوجد نوع رعاية منزلية فعال بهذا الاسم');
    });

    test('updates display order and status without deleting the category', async () => {
        const current = { status: IHomeCareStatusEnum.ACTIVE, normalized_name: 'تمريض' };
        spyOn(HomeCareCategory, 'findById').mockReturnValue({
            select() { return this; },
            exec: async () => current,
        } as never);
        spyOn(HomeCareCategory, 'exists').mockResolvedValue(null);
        const update = spyOn(HomeCareCategory, 'findByIdAndUpdate').mockImplementation((_id, payload) => ({
            exec: async () => ({ ...current, ...(payload as object) }),
        }) as never);
        const service = new HomeCareCategoryService();
        expect((await service.update('507f1f77bcf86cd799439011', { displayOrder: 8 })).display_order).toBe(8);
        expect((await service.updateStatus('507f1f77bcf86cd799439011', IHomeCareStatusEnum.INACTIVE)).status)
            .toBe(IHomeCareStatusEnum.INACTIVE);
        expect(update).toHaveBeenCalledTimes(2);
    });

    test('mobile category query returns only active records in display order', async () => {
        let sort: object | undefined;
        const find = spyOn(HomeCareCategory, 'find').mockReturnValue({
            sort(valueToSort: object) { sort = valueToSort; return this; },
            exec: async () => [],
        } as never);
        await new HomeCareCategoryService().listActive();
        expect(find).toHaveBeenCalledWith({ status: IHomeCareStatusEnum.ACTIVE });
        expect(sort).toMatchObject({ display_order: 1 });
    });
});

describe('Home Care service business rules', () => {
    function mockCategory(category: { status: string } | null) {
        spyOn(HomeCareCategory, 'findById').mockReturnValue({
            select() { return this; },
            lean: async () => category,
        } as never);
    }

    test('creates a fixed-price service in an active category', async () => {
        mockCategory({ status: IHomeCareStatusEnum.ACTIVE });
        const create = spyOn(HomeCareService, 'create').mockImplementation(async (payload) => payload as never);
        const result = await new HomeCareServiceService().create({
            categoryId: '507f1f77bcf86cd799439011', name: 'العناية بالجروح', price: 25000,
            durationMin: 30, durationMax: 45, displayOrder: 2,
        });
        expect(result.price).toBe(25000);
        expect(result.display_order).toBe(2);
        expect(create).toHaveBeenCalledTimes(1);
    });

    test('rejects a missing category', async () => {
        mockCategory(null);
        await expect(new HomeCareServiceService().create({
            categoryId: '507f1f77bcf86cd799439011', name: 'زيارة ممرض', price: 25000,
        })).rejects.toThrow('نوع الرعاية المنزلية غير موجود');
    });

    test('rejects an active service under an inactive category', async () => {
        mockCategory({ status: IHomeCareStatusEnum.INACTIVE });
        await expect(new HomeCareServiceService().create({
            categoryId: '507f1f77bcf86cd799439011', name: 'زيارة ممرض', price: 25000,
        })).rejects.toThrow('غير فعال');
    });

    test('rejects invalid price and duration updates before persistence', async () => {
        const existing = {
            category_id: new mongoose.Types.ObjectId('507f1f77bcf86cd799439011'), name: 'زيارة ممرض',
            price: 25000, duration_min: 30, duration_max: 45, display_order: 1,
            status: IHomeCareStatusEnum.ACTIVE,
        };
        const service = new HomeCareServiceService();
        spyOn(service, 'getById').mockResolvedValue(existing as never);
        await expect(service.update('507f191e810c19729de860ea', { price: 0 })).rejects.toThrow('السعر');
        await expect(service.update('507f191e810c19729de860ea', { durationMax: 20 })).rejects.toThrow('الحد الأعلى');
    });

    test('updates price and deactivates without hard deletion', async () => {
        const existing = {
            category_id: new mongoose.Types.ObjectId('507f1f77bcf86cd799439011'), name: 'زيارة ممرض',
            price: 25000, duration_min: null, duration_max: null, display_order: 1,
            status: IHomeCareStatusEnum.ACTIVE,
        };
        const service = new HomeCareServiceService();
        spyOn(service, 'getById').mockResolvedValue(existing as never);
        mockCategory({ status: IHomeCareStatusEnum.ACTIVE });
        const update = spyOn(HomeCareService, 'findByIdAndUpdate').mockImplementation((_id, payload) => ({
            exec: async () => ({ ...existing, ...(payload as object) }),
        }) as never);
        expect((await service.update('507f191e810c19729de860ea', { price: 30000 })).price).toBe(30000);
        expect((await service.updateStatus('507f191e810c19729de860ea', IHomeCareStatusEnum.INACTIVE)).status)
            .toBe(IHomeCareStatusEnum.INACTIVE);
        expect(update).toHaveBeenCalledTimes(2);
    });

    test('mobile service query filters by category and hides services for inactive categories', async () => {
        const activeCategoryId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');
        spyOn(HomeCareCategory, 'find').mockReturnValue({ distinct: () => ({ exec: async () => [activeCategoryId] }) } as never);
        const findServicesForActiveCategory = spyOn(HomeCareService, 'find').mockReturnValue({
            sort: () => ({ exec: async () => [] }),
        } as never);
        await new HomeCareServiceService().listActive(activeCategoryId.toString());
        expect(findServicesForActiveCategory).toHaveBeenCalledWith({
            category_id: { $in: [activeCategoryId] }, status: IHomeCareStatusEnum.ACTIVE,
        });

        mock.restore();
        spyOn(HomeCareCategory, 'find').mockReturnValue({ distinct: () => ({ exec: async () => [] }) } as never);
        const findServices = spyOn(HomeCareService, 'find');
        expect(await new HomeCareServiceService().listActive()).toEqual([]);
        expect(findServices).not.toHaveBeenCalled();
    });
});
