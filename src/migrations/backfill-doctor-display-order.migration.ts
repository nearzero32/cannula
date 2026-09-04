import Doctor from '../models/doctors.model';

/**
 * Gives legacy records a deterministic, spaced position without changing an
 * order already selected by an administrator. Safe to execute repeatedly.
 */
export async function backfillDoctorDisplayOrder() {
    const cursor = Doctor.collection.find({ display_order: { $exists: false } }).sort({ createdAt: 1, _id: 1 });
    const operations: Array<Record<string, unknown>> = [];
    let position = 10;

    for await (const doctor of cursor) {
        operations.push({
            updateOne: {
                filter: { _id: doctor._id, display_order: { $exists: false } },
                update: { $set: { display_order: position } },
            },
        });
        position += 10;
    }

    if (operations.length) await Doctor.collection.bulkWrite(operations as unknown as Parameters<typeof Doctor.collection.bulkWrite>[0], { ordered: true });
}
