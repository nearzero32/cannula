import { describe, expect, test } from 'bun:test';
import Doctor from '../src/models/doctors.model';
import doctorService, { PATIENT_DOCTOR_SORT, patientDoctorSort } from '../src/services/doctor.service';

describe('Doctor display ordering', () => {
    test('new doctors receive a safe default display order and reject negatives', async () => {
        const doctor = new Doctor();
        expect(doctor.display_order).toBe(1000);

        doctor.display_order = -1;
        const error = doctor.validateSync();
        expect(error?.errors.display_order).toBeDefined();
    });

    test('uses one deterministic canonical sort, including lookup collections', () => {
        expect(PATIENT_DOCTOR_SORT).toEqual({ display_order: 1, _id: 1 });
        expect(patientDoctorSort('doctor')).toEqual({ 'doctor.display_order': 1, 'doctor._id': 1 });
    });

    test('sorts before skip and limit for stable patient pagination', async () => {
        const model = (doctorService as any).model;
        const originalAggregate = model.aggregate;
        let pipeline: any[] = [];
        model.aggregate = (value: any[]) => {
            pipeline = value;
            return { exec: async () => [{ data: [], count: [] }] };
        };
        try {
            await doctorService.getPaginated({
                main_match: { status: 'active', is_featured: true },
                sort: PATIENT_DOCTOR_SORT,
                page: 2,
                limit: 5,
            });
        } finally {
            model.aggregate = originalAggregate;
        }

        const dataPipeline = pipeline[1].$facet.data;
        expect(dataPipeline.slice(0, 3)).toEqual([
            { $sort: { display_order: 1, _id: 1 } },
            { $skip: 5 },
            { $limit: 5 },
        ]);
    });

    test('rejects malformed and duplicate reorder IDs before any database write', async () => {
        await expect(doctorService.reorder(['not-an-object-id'])).rejects.toMatchObject({ code: 'INVALID_DOCTOR_ID' });
        const id = '507f1f77bcf86cd799439011';
        await expect(doctorService.reorder([id, id])).rejects.toMatchObject({ code: 'DUPLICATE_DOCTOR_ID' });
    });
});
