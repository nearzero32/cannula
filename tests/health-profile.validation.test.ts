import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import mongoose from 'mongoose';
import { Value } from '@sinclair/typebox/value';
import Patient from '../src/models/patients.model';
import PatientHealthProfile from '../src/models/patient-health-profile.model';
import ChildHealthProfile from '../src/models/child-health-profile.model';
import PatientChild from '../src/models/patient-child.model';
import {
    normalizeHealthStringList,
    prepareHealthProfileUpdate,
    validateMedicalNotes,
} from '../src/services/health-profile.service';
import { healthProfileBodySchema } from '../src/controller/mobile/profile-health.controller';
import { IPatientGenderEnum } from '../src/interfaces/patient.interface';
import ChronicCondition from '../src/models/chronic-conditions.model';

afterEach(() => mock.restore());

describe('Health profile validation and persistence shape', () => {
    test('normalizes string arrays and deduplicates case-insensitively', () => {
        expect(normalizeHealthStringList(['  Penicillin ', '', 'penicillin', ' Dust ']))
            .toEqual(['Penicillin', 'Dust']);
    });

    test('rejects non-positive measurements and malformed chronic condition IDs', async () => {
        await expect(prepareHealthProfileUpdate({ weight: 0 })).rejects.toThrow('الوزن');
        await expect(prepareHealthProfileUpdate({ height: -1 })).rejects.toThrow('الطول');
        await expect(prepareHealthProfileUpdate({ chronic_condition_ids: ['invalid'] }))
            .rejects.toThrow('غير صالح');
    });

    test('rejects a valid-looking chronic condition id that does not exist', async () => {
        spyOn(ChronicCondition, 'countDocuments').mockReturnValue({ exec: async () => 0 } as never);
        await expect(prepareHealthProfileUpdate({
            chronic_condition_ids: [new mongoose.Types.ObjectId().toString()],
        })).rejects.toThrow('غير موجود');
    });

    test('bounds medical notes and turns whitespace-only notes into null', () => {
        expect(validateMedicalNotes('   ')).toBeNull();
        expect(() => validateMedicalNotes('x'.repeat(4001))).toThrow('4000');
    });

    test('health request rejects ownership mass assignment', () => {
        expect(Value.Check(healthProfileBodySchema, {
            weight: 20,
            patient_id: new mongoose.Types.ObjectId().toString(),
        })).toBe(false);
    });

    test('schemas enforce blood type, positive units, and one-to-one indexes', async () => {
        const patientId = new mongoose.Types.ObjectId();
        await expect(new PatientHealthProfile({ patient_id: patientId, blood_type: 'O+', weight: 20, height: 110 }).validate())
            .resolves.toBeUndefined();
        await expect(new PatientHealthProfile({ patient_id: patientId, blood_type: 'X', weight: 0 }).validate())
            .rejects.toThrow();
        expect(PatientHealthProfile.schema.indexes().some(([fields, options]) => fields.patient_id === 1 && options.unique === true)).toBe(true);
        expect(ChildHealthProfile.schema.indexes().some(([fields, options]) => fields.child_id === 1 && options.unique === true)).toBe(true);
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
