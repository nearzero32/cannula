import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import mongoose from 'mongoose';
import { Value } from '@sinclair/typebox/value';
import Patient from '../src/models/patients.model';
import PatientHealthProfile from '../src/models/patient-health-profile.model';
import ChildHealthProfile from '../src/models/child-health-profile.model';
import PatientChild from '../src/models/patient-child.model';
import {
    normalizeHealthStringList,
    normalizeAllergies,
    prepareHealthProfileUpdate,
} from '../src/services/health-profile.service';
import { patientManagedHealthProfileBodySchema } from '../src/controller/mobile/profile-health.controller';
import { IPatientGenderEnum } from '../src/interfaces/patient.interface';
import ChronicCondition from '../src/models/chronic-conditions.model';

afterEach(() => mock.restore());

describe('Health profile validation and persistence shape', () => {
    test('normalizes string arrays and deduplicates case-insensitively', () => {
        expect(normalizeHealthStringList(['  Penicillin ', '', 'penicillin', ' Dust ']))
            .toEqual(['Penicillin', 'Dust']);
    });

    test('rejects malformed chronic condition IDs', async () => {
        await expect(prepareHealthProfileUpdate({ chronic_condition_ids: ['invalid'] }))
            .rejects.toThrow('غير صالح');
    });

    test('rejects a valid-looking chronic condition id that does not exist', async () => {
        spyOn(ChronicCondition, 'countDocuments').mockReturnValue({ exec: async () => 0 } as never);
        await expect(prepareHealthProfileUpdate({
            chronic_condition_ids: [new mongoose.Types.ObjectId().toString()],
        })).rejects.toThrow('غير موجود');
    });

    test('deduplicates chronic conditions and accepts only active supported records', async () => {
        const id1 = new mongoose.Types.ObjectId();
        const id2 = new mongoose.Types.ObjectId();
        const countDocuments = spyOn(ChronicCondition, 'countDocuments')
            .mockReturnValue({ exec: async () => 2 } as never);
        const update = await prepareHealthProfileUpdate({
            chronic_condition_ids: [id1.toString(), id1.toString(), id2.toString()],
        });
        expect(update.chronic_condition_ids?.map(String)).toEqual([id1.toString(), id2.toString()]);
        expect(countDocuments).toHaveBeenCalledWith({
            _id: { $in: [id1, id2] },
            status: 'active',
        });
    });

    test('supports replacement clearing and blood-type clearing without touching legacy fields', async () => {
        spyOn(ChronicCondition, 'countDocuments').mockReturnValue({ exec: async () => 0 } as never);
        const update = await prepareHealthProfileUpdate({
            blood_type: null,
            chronic_condition_ids: [],
            allergies: [],
        });
        expect(update).toEqual({ blood_type: null, allergies: [], chronic_condition_ids: [] });
        expect(update).not.toHaveProperty('current_medications');
        expect(update).not.toHaveProperty('weight');
        expect(update).not.toHaveProperty('height');
        expect(update).not.toHaveProperty('medical_notes');
    });

    test('rejects empty and overlong allergies and normalizes duplicates', () => {
        expect(() => normalizeAllergies(['   '])).toThrow('فارغة');
        expect(() => normalizeAllergies(['x'.repeat(121)])).toThrow('120');
        expect(normalizeAllergies([' Penicillin ', 'penicillin', 'Peanuts']))
            .toEqual(['Penicillin', 'Peanuts']);
    });

    test('patient health request rejects system-managed and ownership fields', () => {
        for (const forbidden of ['weight', 'height', 'current_medications', 'medical_notes', 'patient_id']) {
            expect(Value.Check(patientManagedHealthProfileBodySchema, { [forbidden]: 'value' })).toBe(false);
        }
        expect(Value.Check(patientManagedHealthProfileBodySchema, { blood_type: 'O-' })).toBe(true);
        expect(Value.Check(patientManagedHealthProfileBodySchema, { blood_type: null })).toBe(true);
        expect(Value.Check(patientManagedHealthProfileBodySchema, { allergies: [] })).toBe(true);
        expect(Value.Check(patientManagedHealthProfileBodySchema, { chronic_condition_ids: [] })).toBe(true);
    });

    test('schemas enforce blood type, positive units, and one-to-one indexes', async () => {
        const patientId = new mongoose.Types.ObjectId();
        await expect(new PatientHealthProfile({ patient_id: patientId, blood_type: 'O+', weight: 20, height: 110 }).validate())
            .resolves.toBeUndefined();
        await expect(new PatientHealthProfile({ patient_id: patientId, blood_type: 'X', weight: 0 }).validate())
            .rejects.toThrow();
        expect(PatientHealthProfile.schema.indexes().some(([fields, options]) => fields.patient_id === 1 && options.unique === true)).toBe(true);
        expect(ChildHealthProfile.schema.indexes().some(([fields, options]) => fields.child_id === 1 && options.unique === true)).toBe(true);
        expect(PatientHealthProfile.schema.path('current_medications')).toBeDefined();
        expect(PatientHealthProfile.schema.path('medical_notes')).toBeDefined();
    });

    test('patient identity no longer duplicates health fields and child has no account fields', () => {
        expect(Patient.schema.path('blood_group')).toBeUndefined();
        expect(Patient.schema.path('allergies')).toBeUndefined();
        expect(Patient.schema.path('chronic_condition_ids')).toBeUndefined();
        for (const forbidden of ['phone', 'password', 'otp', 'user_id', 'session']) {
            expect(PatientChild.schema.path(forbidden)).toBeUndefined();
        }
    });

    test('child schema rejects a future birth date and invalid gender', async () => {
        const base = {
            patient_id: new mongoose.Types.ObjectId(),
            full_name: 'محمد أحمد',
            date_of_birth: new Date(Date.now() + 86_400_000),
            gender: IPatientGenderEnum.MALE,
        };
        await expect(new PatientChild(base).validate()).rejects.toThrow('المستقبل');
        await expect(new PatientChild({ ...base, date_of_birth: new Date('2020-01-01'), gender: 'other' }).validate())
            .rejects.toThrow();
    });
});
