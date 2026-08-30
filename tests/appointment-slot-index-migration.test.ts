import { describe, expect, test } from 'bun:test';
import {
    ActiveAppointmentSlotDuplicatesError,
    runAppointmentSlotIndexRepair,
    type AppointmentIndexDescription,
    type AppointmentIndexRepairDependencies,
} from '../src/migrations/repair-appointment-slot-index.migration';
import {
    APPOINTMENT_BLOCKING_STATUSES,
    APPOINTMENT_SLOT_INDEX_NAME,
} from '../src/models/appointments.model';

class MemoryIndexRepair implements AppointmentIndexRepairDependencies {
    readonly dropped: string[] = [];
    readonly logs: string[] = [];
    duplicates: Awaited<ReturnType<AppointmentIndexRepairDependencies['findActiveSlotDuplicates']>> = [];
    duplicateChecks = 0;
    created = 0;
    ensured = 0;

    async listIndexes(): Promise<AppointmentIndexDescription[]> {
        return [
            { name: '_id_', key: { _id: 1 } },
            { name: 'legacy_start_time', key: { doctor_id: 1, date: 1, start_time: 1 } },
            {
                name: 'doctor_id_1_date_1_starts_at_1',
                key: { doctor_id: 1, date: 1, starts_at: 1 },
                unique: true,
                partialFilterExpression: { status: { $in: ['cancelled'] } },
            },
        ];
    }
    async findActiveSlotDuplicates() {
        this.duplicateChecks += 1;
        return this.duplicates;
    }
    async dropIndex(name: string) { this.dropped.push(name); }
    async createCurrentIndex() { this.created += 1; }
    async ensureOtherIndexes() { this.ensured += 1; }
    log(message: string) { this.logs.push(message); }
}

describe('Appointment slot index migration', () => {
    test('replaces only outdated slot indexes after checking data', async () => {
        const memory = new MemoryIndexRepair();
        expect(await runAppointmentSlotIndexRepair(memory)).toEqual({ dropped: 2, created: true });
        expect(memory.dropped).toEqual([
            'doctor_id_1_date_1_starts_at_1',
            'legacy_start_time',
        ]);
        expect(memory.duplicateChecks).toBe(1);
        expect(memory.created).toBe(1);
        expect(memory.ensured).toBe(1);
        expect(memory.logs.some(message => message.includes(APPOINTMENT_SLOT_INDEX_NAME))).toBe(true);
    });

    test('is idempotent when the desired index already exists', async () => {
        const memory = new MemoryIndexRepair();
        memory.listIndexes = async () => [
            {
                name: APPOINTMENT_SLOT_INDEX_NAME,
                key: { doctor_id: 1, date: 1, starts_at: 1 },
                unique: true,
                partialFilterExpression: { status: { $in: [...APPOINTMENT_BLOCKING_STATUSES] } },
            },
        ];
        expect(await runAppointmentSlotIndexRepair(memory)).toEqual({ dropped: 0, created: false });
        expect(memory.dropped).toEqual([]);
        expect(memory.duplicateChecks).toBe(0);
        expect(memory.created).toBe(0);
        expect(memory.ensured).toBe(1);
    });

    test('reports active duplicates and leaves indexes and data untouched', async () => {
        const memory = new MemoryIndexRepair();
        memory.duplicates = [{
            doctor_id: 'doctor-1',
            date: '2026-09-01',
            starts_at: '09:00',
            count: 2,
            appointment_ids: ['appointment-1', 'appointment-2'],
            statuses: ['pending', 'confirmed'],
        }];

        await expect(runAppointmentSlotIndexRepair(memory)).rejects.toBeInstanceOf(
            ActiveAppointmentSlotDuplicatesError
        );
        expect(memory.dropped).toEqual([]);
        expect(memory.created).toBe(0);
        expect(memory.ensured).toBe(0);
        expect(memory.logs.join(' ')).toContain('appointment-1');
    });
});
