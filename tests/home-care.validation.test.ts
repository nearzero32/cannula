import { describe, expect, test } from 'bun:test';
import HomeCareCategory from '../src/models/home-care-category.model';
import HomeCareService from '../src/models/home-care-service.model';
import { IHomeCareStatusEnum } from '../src/interfaces/home-care.interface';
import { normalizeHomeCareName, validateHomeCareServiceNumbers } from '../src/services/home-care.validation';
import mongoose from 'mongoose';

describe('Home Care validation and schemas', () => {
    test('trims and normalizes category names and rejects whitespace-only names', () => {
        expect(normalizeHomeCareName('  رعاية   منزلية  ')).toEqual({
            name: 'رعاية منزلية',
            normalizedName: 'رعاية منزلية',
        });
        expect(() => normalizeHomeCareName('   ')).toThrow('الاسم مطلوب');
    });

    test('category schema supports status and non-negative integer ordering', async () => {
        const valid = new HomeCareCategory({
            name: 'تمريض', normalized_name: 'تمريض', status: IHomeCareStatusEnum.ACTIVE, display_order: 2,
        });
        await expect(valid.validate()).resolves.toBeUndefined();

        const invalid = new HomeCareCategory({
            name: 'تمريض', normalized_name: 'تمريض', status: 'deleted', display_order: 1.5,
        });
        await expect(invalid.validate()).rejects.toThrow();
    });

    test('service requires a positive whole-dinar fixed price', async () => {
        const base = {
            category_id: new mongoose.Types.ObjectId(), name: 'زيارة منزلية',
            status: IHomeCareStatusEnum.ACTIVE, display_order: 1,
        };
        await expect(new HomeCareService({ ...base, price: 25000 }).validate()).resolves.toBeUndefined();
        await expect(new HomeCareService({ ...base, price: 0 }).validate()).rejects.toThrow();
        await expect(new HomeCareService({ ...base, price: 25.5 }).validate()).rejects.toThrow();
    });

    test('duration maximum cannot be below duration minimum', () => {
        expect(() => validateHomeCareServiceNumbers({
            price: 25000, durationMin: 45, durationMax: 30, displayOrder: 1,
        })).toThrow('الحد الأعلى للمدة');
        expect(() => validateHomeCareServiceNumbers({
            price: 25000, durationMin: 30, durationMax: 45, displayOrder: 1,
        })).not.toThrow();
    });

    test('schemas expose the required query indexes and no delete concept', () => {
        const categoryIndexes = HomeCareCategory.schema.indexes();
        const serviceIndexes = HomeCareService.schema.indexes();
        expect(categoryIndexes.some(([fields]) => fields.status === 1 && fields.display_order === 1)).toBe(true);
        expect(serviceIndexes.some(([fields]) => fields.category_id === 1 && fields.status === 1 && fields.display_order === 1)).toBe(true);
        expect(HomeCareCategory.schema.path('deletedAt')).toBeUndefined();
        expect(HomeCareService.schema.path('deletedAt')).toBeUndefined();
    });
});

