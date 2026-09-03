import mongoose, { type ClientSession } from 'mongoose';
export interface AppointmentTransactionRunner { run<T>(work: (session: ClientSession | null) => Promise<T>): Promise<T> }
export class MongooseAppointmentTransactionRunner implements AppointmentTransactionRunner {
    async run<T>(work: (session: ClientSession) => Promise<T>) {
        // A first-ever doctor/day lock can race on its unique _id upsert. Retry
        // that duplicate-key transaction from a fresh snapshot so the loser
        // observes the winner's appointment and returns a slot conflict.
        for (let attempt = 0; attempt < 3; attempt++) {
            const session = await mongoose.startSession(); let result!: T;
            try {
                await session.withTransaction(async () => { result = await work(session); }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' });
                return result;
            } catch (error: any) {
                if (error?.code !== 11000 || attempt === 2) throw error;
            } finally { await session.endSession(); }
        }
        throw new Error('Appointment transaction retry exhausted');
    }
}
export const directAppointmentTransactionRunner: AppointmentTransactionRunner = { run: work => work(null) };
export type AppointmentMongoHello = { setName?: unknown; msg?: unknown };
export function supportsAppointmentTransactions(hello: AppointmentMongoHello): boolean {
    return (typeof hello.setName === 'string' && hello.setName.length > 0) || hello.msg === 'isdbgrid';
}
export async function assertAppointmentTransactionSupport(): Promise<void> {
    const database = mongoose.connection.db;
    if (!database) throw new Error('MongoDB must be connected before checking Appointment transaction support');
    const hello = await database.admin().command({ hello: 1 });
    if (!supportsAppointmentTransactions(hello)) throw new Error('Appointments require MongoDB replica-set or mongos transaction support');
}
export default new MongooseAppointmentTransactionRunner();
