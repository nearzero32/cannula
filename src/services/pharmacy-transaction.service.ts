import mongoose, { type ClientSession } from 'mongoose';

export interface PharmacyTransactionRunner {
    run<T>(work: (session: ClientSession | null) => Promise<T>): Promise<T>;
}

export class MongoosePharmacyTransactionRunner implements PharmacyTransactionRunner {
    async run<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
        const session = await mongoose.startSession();
        let result!: T;
        try {
            await session.withTransaction(async () => { result = await work(session); }, {
                readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary',
            });
            return result;
        } finally {
            await session.endSession();
        }
    }
}

export const directPharmacyTransactionRunner: PharmacyTransactionRunner = { run: work => work(null) };
export type PharmacyMongoHello = { setName?: unknown; msg?: unknown };
export function supportsPharmacyTransactions(hello: PharmacyMongoHello): boolean {
    return (typeof hello.setName === 'string' && hello.setName.length > 0) || hello.msg === 'isdbgrid';
}
export async function assertPharmacyTransactionSupport():Promise<void>{
    const database=mongoose.connection.db;
    if(!database)throw new Error('MongoDB must be connected before checking Pharmacy transaction support');
    const hello=await database.admin().command({hello:1});
    if(!supportsPharmacyTransactions(hello))throw new Error('Pharmacy Treatment Requests require MongoDB replica-set or mongos transaction support');
}
export default new MongoosePharmacyTransactionRunner();
