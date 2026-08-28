import { describe, expect, test } from 'bun:test';
import { seedHomeCareCategories } from '../src/migrations/seed-home-care-categories.migration';

interface SeedRow { _id: string; seed_key?: string; normalized_name: string; name: string; display_order: number }

class MemoryCategoryModel {
    rows: SeedRow[] = [];

    async findOne(filter: Record<string, unknown>): Promise<SeedRow | null> {
        return this.rows.find((row) => Object.entries(filter).every(([key, value]) => row[key as keyof SeedRow] === value)) ?? null;
    }

    async updateOne(filter: Record<string, unknown>, update: Record<string, unknown>): Promise<void> {
        const row = await this.findOne(filter);
        if (row && update.$set && typeof update.$set === 'object') Object.assign(row, update.$set);
    }

    async create(payload: Record<string, unknown>): Promise<void> {
        this.rows.push({ _id: String(this.rows.length + 1), ...payload } as SeedRow);
    }
}

describe('Home Care category migration', () => {
    test('creates the three initial categories with stable ordering', async () => {
        const model = new MemoryCategoryModel();
        const result = await seedHomeCareCategories(model);
        expect(result.inserted).toBe(3);
        expect(model.rows.map(({ name, display_order }) => ({ name, display_order }))).toEqual([
            { name: 'تحاليل', display_order: 1 },
            { name: 'تمريض', display_order: 2 },
            { name: 'رعاية', display_order: 3 },
        ]);
    });

    test('is idempotent when run twice', async () => {
        const model = new MemoryCategoryModel();
        await seedHomeCareCategories(model);
        const second = await seedHomeCareCategories(model);
        expect(model.rows).toHaveLength(3);
        expect(second).toEqual({ inserted: 0, linked: 0, skipped: 3 });
    });

    test('links an existing matching category instead of duplicating it', async () => {
        const model = new MemoryCategoryModel();
        model.rows.push({ _id: 'existing', name: 'تحاليل', normalized_name: 'تحاليل', display_order: 9 });
        const result = await seedHomeCareCategories(model);
        expect(model.rows.filter((row) => row.name === 'تحاليل')).toHaveLength(1);
        expect(model.rows[0]?.seed_key).toBe('home-care-analysis');
        expect(result.linked).toBe(1);
    });
});

