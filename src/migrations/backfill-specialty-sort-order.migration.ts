import Specialty from '../models/specialties.model';

/** Gives only unordered legacy specialties a deterministic, spaced position. */
export async function backfillSpecialtySortOrder() {
    const cursor = Specialty.collection.find({ sort_order: { $exists: false } }).sort({ createdAt: 1, _id: 1 });
    let position = 10;
    let operations: Array<Record<string, unknown>> = [];
    for await (const specialty of cursor) {
        operations.push({ updateOne: { filter: { _id: specialty._id, sort_order: { $exists: false } }, update: { $set: { sort_order: position } } } });
        position += 10;
        if (operations.length === 500) {
            await Specialty.collection.bulkWrite(operations as unknown as Parameters<typeof Specialty.collection.bulkWrite>[0], { ordered: true });
            operations = [];
        }
    }
    if (operations.length) await Specialty.collection.bulkWrite(operations as unknown as Parameters<typeof Specialty.collection.bulkWrite>[0], { ordered: true });
}
