import { describe, expect, test } from 'bun:test';
import {
    runAppointmentSlotIndexRepair,
    type AppointmentIndexRepairDependencies,
} from '../src/migrations/repair-appointment-slot-index.migration';

class MemoryIndexRepair implements AppointmentIndexRepairDependencies {
    readonly dropped: string[] = [];
    ensured = 0;

    async listIndexes(): Promise<Array<{ name: string; key: Record<string, number> }>> {
        return [
            { name: '_id_', key: { _id: 1 } },
            { name: 'old_slot', key: { doctor_id: 1, date: 1, start_time: 1 } },
            { name: 'current_slot', key: { doctor_id: 1, date: 1, starts_at: 1 } },
        ];
    }
    async dropIndex(name: string) { this.dropped.push(name); }
    async ensureCurrentIndexes() { this.ensured += 1; }
}

describe('Appointment slot index migration', () => {
    test('drops only the obsolete start_time index and ensures the corrected index', async () => {
        const memory = new MemoryIndexRepair();
        expect(await runAppointmentSlotIndexRepair(memory)).toEqual({ dropped: 1 });
        expect(memory.dropped).toEqual(['old_slot']);
        expect(memory.ensured).toBe(1);
    });

    test('is idempotent when the obsolete index is already absent', async () => {
        const memory = new MemoryIndexRepair();
        memory.listIndexes = async () => [
            { name: 'current_slot', key: { doctor_id: 1, date: 1, starts_at: 1 } },
        ];
        expect(await runAppointmentSlotIndexRepair(memory)).toEqual({ dropped: 0 });
        expect(memory.dropped).toEqual([]);
        expect(memory.ensured).toBe(1);
    });
});
