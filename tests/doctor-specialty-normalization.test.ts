import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import mongoose from 'mongoose';
import Specialty from '../src/models/specialties.model';
import { validateDoctorSpecialties } from '../src/services/doctor-specialty.service';
import Doctor from '../src/models/doctors.model';

afterEach(() => mock.restore());

describe('Doctor specialty ObjectId relationships', () => {
    test('schema uses ObjectId refs and no fragile label fields', () => {
        expect(Doctor.schema.path('primary_specialty_id')?.instance).toBe('ObjectId');
        expect(Doctor.schema.path('specialty_ids')?.instance).toBe('Array');
        expect(Doctor.schema.path('specialty')).toBeUndefined();
        expect(Doctor.schema.path('sub_specialties')).toBeUndefined();
    });

    test('primary specialty is always included and duplicate ids are normalized', async () => {
        const primary = new mongoose.Types.ObjectId(), secondary = new mongoose.Types.ObjectId();
        spyOn(Specialty, 'countDocuments').mockResolvedValue(2 as never);
        const result = await validateDoctorSpecialties(String(primary), [String(secondary), String(primary)]);
        expect(result.primary_specialty_id).toEqual(primary);
        expect(result.specialty_ids.map(String)).toEqual([String(primary), String(secondary)]);
    });

    test('rejects nonexistent or inactive specialty ids', async () => {
        const primary = new mongoose.Types.ObjectId();
        spyOn(Specialty, 'countDocuments').mockResolvedValue(0 as never);
        await expect(validateDoctorSpecialties(String(primary), [])).rejects.toMatchObject({ status: 422, code: 'SPECIALTY_INVALID' });
        await expect(validateDoctorSpecialties('bad-id', [])).rejects.toMatchObject({ status: 400, code: 'SPECIALTY_INVALID' });
    });
});
