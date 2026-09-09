import HomeCareAvailabilitySlot from '../models/home-care-availability-slot.model';
import { HOME_CARE_WEEKDAYS } from '../interfaces/home-care.interface';

export interface HomeCareWeeklyAvailabilityMigrationResult {
    unresolved_legacy_slots: number;
    removed_legacy_unique_index: boolean;
    weekly_indexes_ensured: boolean;
}

export interface HomeCareWeeklyAvailabilityMigrationDependencies {
    countLegacySlots(): Promise<number>;
    removeLegacyUniqueIndex(): Promise<boolean>;
    ensureWeeklyIndexes(): Promise<void>;
}

export async function runHomeCareWeeklyAvailabilityMigration(
    dependencies: HomeCareWeeklyAvailabilityMigrationDependencies,
): Promise<HomeCareWeeklyAvailabilityMigrationResult> {
    const unresolvedLegacySlots = await dependencies.countLegacySlots();
    const removedLegacyUniqueIndex = await dependencies.removeLegacyUniqueIndex();
    await dependencies.ensureWeeklyIndexes();
    return {
        unresolved_legacy_slots: unresolvedLegacySlots,
        removed_legacy_unique_index: removedLegacyUniqueIndex,
        weekly_indexes_ensured: true,
    };
}

export async function migrateHomeCareWeeklyAvailability(): Promise<HomeCareWeeklyAvailabilityMigrationResult> {
    await HomeCareAvailabilitySlot.createCollection();
    const collection = HomeCareAvailabilitySlot.collection;
    const result = await runHomeCareWeeklyAvailabilityMigration({
        async countLegacySlots() {
            return await collection.countDocuments({ day_of_week: { $nin: HOME_CARE_WEEKDAYS } });
        },
        async removeLegacyUniqueIndex() {
            const legacy = (await collection.indexes()).find(index =>
                index.unique === true &&
                JSON.stringify(index.key) === JSON.stringify({ service_id: 1, time: 1 })
            );
            if (!legacy) return false;
            await collection.dropIndex(legacy.name!);
            return true;
        },
        async ensureWeeklyIndexes() {
            await collection.createIndex(
                { service_id: 1, day_of_week: 1, time: 1 },
                {
                    name: 'home_care_service_weekday_time_unique',
                    unique: true,
                    partialFilterExpression: { day_of_week: { $type: 'string' } },
                },
            );
            await collection.createIndex(
                { service_id: 1, day_of_week: 1, status: 1, display_order: 1 },
                { name: 'home_care_service_weekday_active_order' },
            );
        },
    });
    if (result.unresolved_legacy_slots > 0) {
        console.warn(`[Migration] Home Care weekly availability: ${result.unresolved_legacy_slots} legacy slot(s) remain unresolved and are excluded from new schedules; explicit weekday classification is required.`);
    } else {
        console.log('[Migration] Home Care weekly availability: no unresolved legacy slots detected.');
    }
    return result;
}
