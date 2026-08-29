import { describe, expect, test } from 'bun:test';
import mongoose from 'mongoose';
import {
    runHealthProfileBackfill,
    type HealthBackfillDependencies,
    type LegacyPatientHealthRow,
} from '../src/migrations/backfill-health-profiles.migration';

class MemoryHealthBackfill implements HealthBackfillDependencies {
    readonly patientProfiles = new Set<string>();
    readonly childProfiles = new Set<string>();
    readonly cleanedPatients = new Set<string>();

    constructor(
        readonly patients: LegacyPatientHealthRow[],
        readonly childIds: mongoose.Types.ObjectId[]
    ) {}

    async listPatients() { return this.patients; }
    async upsertPatientProfile(patient: LegacyPatientHealthRow) {
        const id = patient._id.toString();
        const created = !this.patientProfiles.has(id);
        this.patientProfiles.add(id);
        return created;
    }
    async clearLegacyPatientHealth(patientId: mongoose.Types.ObjectId) {
        this.cleanedPatients.add(patientId.toString());
    }
    async listChildIds() { return this.childIds; }
    async upsertChildProfile(childId: mongoose.Types.ObjectId) {
        const id = childId.toString();
        const created = !this.childProfiles.has(id);
        this.childProfiles.add(id);
        return created;
    }
}

describe('Health profile backfill', () => {
    test('creates missing patient and child profiles', async () => {
        const patientId = new mongoose.Types.ObjectId();
        const childId = new mongoose.Types.ObjectId();
        const memory = new MemoryHealthBackfill([{ _id: patientId, blood_group: 'O+' }], [childId]);
        expect(await runHealthProfileBackfill(memory)).toEqual({
            patient_profiles_created: 1,
            child_profiles_created: 1,
            patients_cleaned: 1,
        });
        expect(memory.cleanedPatients.has(patientId.toString())).toBe(true);
    });

    test('is idempotent when run twice', async () => {
        const memory = new MemoryHealthBackfill(
            [{ _id: new mongoose.Types.ObjectId(), allergies: ['dust'] }],
            [new mongoose.Types.ObjectId()]
        );
        await runHealthProfileBackfill(memory);
        const second = await runHealthProfileBackfill(memory);
        expect(second.patient_profiles_created).toBe(0);
        expect(second.child_profiles_created).toBe(0);
        expect(memory.patientProfiles.size).toBe(1);
        expect(memory.childProfiles.size).toBe(1);
    });
});
