import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import mongoose, { type Connection } from 'mongoose';
import { IAppointmentStatusEnum } from '../src/interfaces/appointment.interface';
import {
    APPOINTMENT_BLOCKING_STATUSES,
    APPOINTMENT_SLOT_INDEX_KEY,
    APPOINTMENT_SLOT_INDEX_NAME,
} from '../src/models/appointments.model';

const mongoTestUri = process.env.MONGODB_TEST_URI;
const describeWithMongo = mongoTestUri ? describe : describe.skip;

describeWithMongo('Appointment slot unique index against MongoDB', () => {
    let connection: Connection;
    let collection: mongoose.mongo.Collection;
    const databaseName = `cannula_slot_index_test_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const doctor = new mongoose.Types.ObjectId();
    const otherDoctor = new mongoose.Types.ObjectId();
    const date = new Date('2099-01-01T00:00:00.000Z');

    beforeAll(async () => {
        connection = await mongoose.createConnection(mongoTestUri!, { dbName: databaseName }).asPromise();
        collection = connection.collection('appointments');
        await collection.createIndex(APPOINTMENT_SLOT_INDEX_KEY, {
            name: APPOINTMENT_SLOT_INDEX_NAME,
            unique: true,
            partialFilterExpression: { status: { $in: APPOINTMENT_BLOCKING_STATUSES } },
        });
    });

    afterAll(async () => {
        if (connection) {
            await connection.dropDatabase();
            await connection.close();
        }
    });

    async function insert({
        status,
        doctor_id = doctor,
        appointmentDate = date,
        starts_at = '09:00',
    }: {
        status: string;
        doctor_id?: mongoose.Types.ObjectId;
        appointmentDate?: Date;
        starts_at?: string;
    }) {
        return collection.insertOne({
            appointment_number: `TEST-${new mongoose.Types.ObjectId().toString()}`,
            doctor_id,
            date: appointmentDate,
            starts_at,
            status,
        });
    }

    for (const status of APPOINTMENT_BLOCKING_STATUSES) {
        test(`${status} blocks a new pending appointment in the same slot`, async () => {
            await collection.deleteMany({});
            await insert({ status });
            await expect(insert({ status: IAppointmentStatusEnum.PENDING })).rejects.toMatchObject({
                code: 11000,
            });
        });
    }

    for (const status of [
        IAppointmentStatusEnum.CANCELLED,
        IAppointmentStatusEnum.NO_SHOW,
        IAppointmentStatusEnum.RESCHEDULED,
        IAppointmentStatusEnum.COMPLETED,
    ]) {
        test(`${status} releases the slot`, async () => {
            await collection.deleteMany({});
            await insert({ status });
            await expect(insert({ status: IAppointmentStatusEnum.PENDING })).resolves.toBeDefined();
        });
    }

    test('allows the same date and time for a different doctor', async () => {
        await collection.deleteMany({});
        await insert({ status: IAppointmentStatusEnum.PENDING });
        await expect(insert({
            status: IAppointmentStatusEnum.PENDING,
            doctor_id: otherDoctor,
        })).resolves.toBeDefined();
    });

    test('allows a different time for the same doctor and date', async () => {
        await collection.deleteMany({});
        await insert({ status: IAppointmentStatusEnum.PENDING });
        await expect(insert({
            status: IAppointmentStatusEnum.PENDING,
            starts_at: '09:30',
        })).resolves.toBeDefined();
    });

    test('allows a different date for the same doctor and time', async () => {
        await collection.deleteMany({});
        await insert({ status: IAppointmentStatusEnum.PENDING });
        await expect(insert({
            status: IAppointmentStatusEnum.PENDING,
            appointmentDate: new Date('2099-01-02T00:00:00.000Z'),
        })).resolves.toBeDefined();
    });

    test('allows exactly one of ten simultaneous active bookings', async () => {
        await collection.deleteMany({});
        const results = await Promise.allSettled(
            Array.from({ length: 10 }, () => insert({ status: IAppointmentStatusEnum.PENDING }))
        );
        const successes = results.filter(result => result.status === 'fulfilled');
        const failures = results.filter(result => result.status === 'rejected');

        expect(successes).toHaveLength(1);
        expect(failures).toHaveLength(9);
        for (const failure of failures) {
            expect((failure as PromiseRejectedResult).reason).toMatchObject({ code: 11000 });
        }
    });
});
