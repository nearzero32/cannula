import { describe, expect, test } from 'bun:test';
import { runHomeCareWeeklyAvailabilityMigration } from '../src/migrations/home-care-weekly-availability.migration';

describe('Home Care weekly availability migration', () => {
    test('reports unresolved legacy slots without assigning or deleting them', async () => {
        let ensured = false;
        const result = await runHomeCareWeeklyAvailabilityMigration({
            countLegacySlots: async () => 3,
            removeLegacyUniqueIndex: async () => true,
            ensureWeeklyIndexes: async () => { ensured = true; },
        });
        expect(result).toEqual({
            unresolved_legacy_slots: 3,
            removed_legacy_unique_index: true,
            weekly_indexes_ensured: true,
        });
        expect(ensured).toBe(true);
    });

    test('reports an empty database clearly and remains idempotent', async () => {
        const result = await runHomeCareWeeklyAvailabilityMigration({
            countLegacySlots: async () => 0,
            removeLegacyUniqueIndex: async () => false,
            ensureWeeklyIndexes: async () => {},
        });
        expect(result.unresolved_legacy_slots).toBe(0);
        expect(result.removed_legacy_unique_index).toBe(false);
    });
});
