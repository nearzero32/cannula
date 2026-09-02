import User from '../models/users.model';

/** Removes the retired recoverable credential field without reading or logging its value. */
export async function removePasswordShow(): Promise<{ checked: number; removed: number }> {
    const result = await User.collection.updateMany(
        { password_show: { $exists: true } } as never,
        { $unset: { password_show: '' } } as never
    );
    const counts = { checked: result.matchedCount, removed: result.modifiedCount };
    console.log(`[Migration] User credential cleanup complete: ${counts.checked} checked, ${counts.removed} removed`);
    return counts;
}
