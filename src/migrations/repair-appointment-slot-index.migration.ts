import Appointment, {
    APPOINTMENT_BLOCKING_STATUSES,
    APPOINTMENT_SLOT_INDEX_KEY,
    APPOINTMENT_SLOT_INDEX_NAME,
} from '../models/appointments.model';

export interface AppointmentIndexDescription {
    name?: string;
    key: Record<string, number>;
    unique?: boolean;
    partialFilterExpression?: {
        status?: { $in?: readonly string[] };
    };
}

export interface ActiveAppointmentSlotDuplicate {
    doctor_id: unknown;
    date: unknown;
    starts_at: unknown;
    count: number;
    appointment_ids: unknown[];
    statuses: string[];
}

export interface AppointmentIndexRepairDependencies {
    listIndexes(): Promise<AppointmentIndexDescription[]>;
    findActiveSlotDuplicates(): Promise<ActiveAppointmentSlotDuplicate[]>;
    dropIndex(name: string): Promise<void>;
    createCurrentIndex(): Promise<void>;
    ensureOtherIndexes(): Promise<void>;
    log(message: string): void;
}

export class ActiveAppointmentSlotDuplicatesError extends Error {
    constructor(public readonly duplicates: ActiveAppointmentSlotDuplicate[]) {
        super(
            `Cannot create ${APPOINTMENT_SLOT_INDEX_NAME}: found ${duplicates.length} ` +
            `duplicate active appointment slot(s). Resolve these records manually: ` +
            JSON.stringify(duplicates)
        );
        this.name = 'ActiveAppointmentSlotDuplicatesError';
    }
}

function hasExactKey(index: AppointmentIndexDescription, fieldNames: readonly string[]): boolean {
    const keys = Object.keys(index.key);
    return keys.length === fieldNames.length &&
        fieldNames.every((field, position) => keys[position] === field && index.key[field] === 1);
}

function isDesiredSlotIndex(index: AppointmentIndexDescription): boolean {
    if (index.name !== APPOINTMENT_SLOT_INDEX_NAME ||
        !hasExactKey(index, ['doctor_id', 'date', 'starts_at']) ||
        index.unique !== true) {
        return false;
    }
    const actualStatuses = index.partialFilterExpression?.status?.$in;
    return Array.isArray(actualStatuses) &&
        actualStatuses.length === APPOINTMENT_BLOCKING_STATUSES.length &&
        APPOINTMENT_BLOCKING_STATUSES.every(status => actualStatuses.includes(status));
}

function isCurrentKeySlotIndex(index: AppointmentIndexDescription): boolean {
    return hasExactKey(index, ['doctor_id', 'date', 'starts_at']);
}

function isLegacyStartTimeSlotIndex(index: AppointmentIndexDescription): boolean {
    return hasExactKey(index, ['doctor_id', 'date', 'start_time']);
}

export async function runAppointmentSlotIndexRepair(
    dependencies: AppointmentIndexRepairDependencies
): Promise<{ dropped: number; created: boolean }> {
    const indexes = await dependencies.listIndexes();
    const desiredExists = indexes.some(isDesiredSlotIndex);
    const conflictingIndexes = indexes.filter(
        index => isCurrentKeySlotIndex(index) && !isDesiredSlotIndex(index) && index.name
    );
    const legacyIndexes = indexes.filter(index => isLegacyStartTimeSlotIndex(index) && index.name);
    let dropped = 0;
    let created = false;

    if (!desiredExists) {
        const duplicates = await dependencies.findActiveSlotDuplicates();
        if (duplicates.length > 0) {
            dependencies.log(
                `[Migration] Active appointment slot duplicates detected: ${JSON.stringify(duplicates)}`
            );
            throw new ActiveAppointmentSlotDuplicatesError(duplicates);
        }

        for (const index of conflictingIndexes) {
            await dependencies.dropIndex(index.name!);
            dependencies.log(`[Migration] Dropped outdated appointment slot index: ${index.name}`);
            dropped += 1;
        }

        await dependencies.createCurrentIndex();
        dependencies.log(`[Migration] Created appointment slot index: ${APPOINTMENT_SLOT_INDEX_NAME}`);
        created = true;
    }

    // This obsolete key can remain until the corrected protection is known to exist.
    for (const index of legacyIndexes) {
        await dependencies.dropIndex(index.name!);
        dependencies.log(`[Migration] Dropped obsolete appointment slot index: ${index.name}`);
        dropped += 1;
    }

    await dependencies.ensureOtherIndexes();
    return { dropped, created };
}

function isNamespaceNotFound(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 26;
}

export async function repairAppointmentSlotIndex(): Promise<{ dropped: number; created: boolean }> {
    const result = await runAppointmentSlotIndexRepair({
        async listIndexes() {
            try {
                return await Appointment.collection.indexes() as AppointmentIndexDescription[];
            } catch (error) {
                if (isNamespaceNotFound(error)) return [];
                throw error;
            }
        },
        async findActiveSlotDuplicates() {
            return await Appointment.aggregate<ActiveAppointmentSlotDuplicate>([
                { $match: { status: { $in: APPOINTMENT_BLOCKING_STATUSES } } },
                {
                    $group: {
                        _id: {
                            doctor_id: '$doctor_id',
                            date: '$date',
                            starts_at: '$starts_at',
                        },
                        count: { $sum: 1 },
                        appointment_ids: { $push: '$_id' },
                        statuses: { $push: '$status' },
                    },
                },
                { $match: { count: { $gt: 1 } } },
                { $sort: { count: -1 } },
                {
                    $project: {
                        _id: 0,
                        doctor_id: '$_id.doctor_id',
                        date: '$_id.date',
                        starts_at: '$_id.starts_at',
                        count: 1,
                        appointment_ids: 1,
                        statuses: 1,
                    },
                },
            ]).exec();
        },
        async dropIndex(name) {
            await Appointment.collection.dropIndex(name);
        },
        async createCurrentIndex() {
            await Appointment.collection.createIndex(APPOINTMENT_SLOT_INDEX_KEY, {
                name: APPOINTMENT_SLOT_INDEX_NAME,
                unique: true,
                partialFilterExpression: { status: { $in: APPOINTMENT_BLOCKING_STATUSES } },
            });
        },
        async ensureOtherIndexes() {
            await Appointment.createIndexes();
        },
        log(message) {
            console.log(message);
        },
    });
    console.log(
        `[Migration] Appointment slot index repair complete: created=${result.created}, ` +
        `dropped=${result.dropped}`
    );
    return result;
}
