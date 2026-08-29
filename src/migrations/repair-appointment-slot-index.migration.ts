import Appointment from '../models/appointments.model';

interface AppointmentIndexDescription {
    name?: string;
    key: Record<string, number>;
}

export interface AppointmentIndexRepairDependencies {
    listIndexes(): Promise<AppointmentIndexDescription[]>;
    dropIndex(name: string): Promise<void>;
    ensureCurrentIndexes(): Promise<void>;
}

export async function runAppointmentSlotIndexRepair(
    dependencies: AppointmentIndexRepairDependencies
): Promise<{ dropped: number }> {
    let dropped = 0;
    const indexes = await dependencies.listIndexes();
    // Create the corrected index first; if this fails, the old protection remains intact.
    await dependencies.ensureCurrentIndexes();
    for (const index of indexes) {
        const obsoleteSlotIndex = index.key.doctor_id === 1 && index.key.date === 1 &&
            index.key.start_time === 1 && index.key.starts_at === undefined;
        if (obsoleteSlotIndex && index.name) {
            await dependencies.dropIndex(index.name);
            dropped += 1;
        }
    }
    return { dropped };
}

export async function repairAppointmentSlotIndex(): Promise<{ dropped: number }> {
    const result = await runAppointmentSlotIndexRepair({
        async listIndexes() {
            return await Appointment.collection.indexes() as AppointmentIndexDescription[];
        },
        async dropIndex(name) {
            await Appointment.collection.dropIndex(name);
        },
        async ensureCurrentIndexes() {
            await Appointment.createIndexes();
        },
    });
    console.log(`[Migration] Appointment slot indexes: ${result.dropped} obsolete index(es) removed`);
    return result;
}
