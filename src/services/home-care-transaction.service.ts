import mongoose, { type ClientSession } from 'mongoose';

/** Runs request mutation and History append as one replica-set transaction. */
export async function runHomeCareTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = await mongoose.startSession();
    try {
        let result!: T;
        await session.withTransaction(async () => { result = await work(session); }, {
            readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary',
        });
        return result;
    } finally { await session.endSession(); }
}
