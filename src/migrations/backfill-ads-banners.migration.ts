import Ads from '../models/ads.model';

/** Safely upgrades legacy Ads without replacing positions already selected by Admins. */
export async function backfillAdsBanners() {
    const cursor = Ads.collection.find({ sort_order: { $exists: false } }).sort({ createdAt: -1, _id: 1 });
    let operations: Array<Record<string, unknown>> = [];
    let position = 10;
    for await (const ad of cursor) {
        operations.push({ updateOne: {
            filter: { _id: ad._id, sort_order: { $exists: false } },
            update: { $set: { sort_order: position }, $unset: { link: '', doctor_id: '', clinic_id: '' } },
        } });
        position += 10;
        if (operations.length === 500) {
            await Ads.collection.bulkWrite(operations as unknown as Parameters<typeof Ads.collection.bulkWrite>[0], { ordered: true });
            operations = [];
        }
    }
    // Also clean legacy destination fields from records that already have an order.
    await Ads.collection.updateMany({ $or: [{ link: { $exists: true } }, { doctor_id: { $exists: true } }, { clinic_id: { $exists: true } }] }, { $unset: { link: '', doctor_id: '', clinic_id: '' } });
    if (operations.length) await Ads.collection.bulkWrite(operations as unknown as Parameters<typeof Ads.collection.bulkWrite>[0], { ordered: true });
}
