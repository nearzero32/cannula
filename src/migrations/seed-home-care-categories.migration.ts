import HomeCareCategory from '../models/home-care-category.model';
import { IHomeCareStatusEnum } from '../interfaces/home-care.interface';
import { normalizeHomeCareName } from '../services/home-care.validation';

export const HOME_CARE_CATEGORY_SEED = [
    { seedKey: 'home-care-analysis', name: 'تحاليل', displayOrder: 1 },
    { seedKey: 'home-care-nursing', name: 'تمريض', displayOrder: 2 },
    { seedKey: 'home-care-care', name: 'رعاية', displayOrder: 3 },
] as const;

interface SeedCategoryModel {
    findOne(filter: Record<string, unknown>): PromiseLike<{ _id: unknown } | null>;
    updateOne(filter: Record<string, unknown>, update: Record<string, unknown>): PromiseLike<unknown>;
    create(payload: Record<string, unknown>): PromiseLike<unknown>;
}

export async function seedHomeCareCategories(
    categoryModel: SeedCategoryModel = HomeCareCategory
): Promise<{ inserted: number; linked: number; skipped: number }> {
    let inserted = 0;
    let linked = 0;
    let skipped = 0;

    for (const item of HOME_CARE_CATEGORY_SEED) {
        const bySeedKey = await categoryModel.findOne({ seed_key: item.seedKey });
        if (bySeedKey) {
            skipped++;
            continue;
        }

        const { normalizedName } = normalizeHomeCareName(item.name);
        const byName = await categoryModel.findOne({ normalized_name: normalizedName });
        if (byName) {
            await categoryModel.updateOne({ _id: byName._id }, { $set: { seed_key: item.seedKey } });
            linked++;
            continue;
        }

        await categoryModel.create({
            seed_key: item.seedKey,
            name: item.name,
            normalized_name: normalizedName,
            status: IHomeCareStatusEnum.ACTIVE,
            display_order: item.displayOrder,
            created_by: null,
        });
        inserted++;
    }

    console.log(
        `[Migration] Home Care categories seed complete: ${inserted} inserted, ${linked} linked, ${skipped} already seeded`
    );
    return { inserted, linked, skipped };
}

