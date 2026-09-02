import { describe, expect, test } from 'bun:test';
import { Value } from '@sinclair/typebox/value';
import mongoose from 'mongoose';
import {
    completeProfileBodySchema,
    formatPatientIdentityResponse,
    formatPatientResponse,
} from '../src/controller/mobile/profile.controller';
import {
    formatPatientHealthResponse,
    patientManagedHealthProfileBodySchema,
} from '../src/controller/mobile/profile-health.controller';
import { calculateAge } from '../src/services/date-of-birth';

describe('Mobile patient profile write ownership', () => {
    test('complete-profile accepts only identity fields including date of birth', () => {
        expect(Value.Check(completeProfileBodySchema, {
            full_name: 'مريض',
            email: 'patient@example.com',
            gender: 'male',
            date_of_birth: '1995-04-20',
            address: 'بغداد',
            profile_photo: null,
        })).toBe(true);

        for (const forbidden of ['blood_group', 'blood_type', 'allergies', 'chronic_condition_ids']) {
            expect(Value.Check(completeProfileBodySchema, { [forbidden]: forbidden === 'allergies' ? [] : 'value' }))
                .toBe(false);
        }
    });

    test('health-profile retains its three patient-managed fields', () => {
        const conditionId = new mongoose.Types.ObjectId().toString();
        expect(Value.Check(patientManagedHealthProfileBodySchema, { blood_type: 'O+' })).toBe(true);
        expect(Value.Check(patientManagedHealthProfileBodySchema, { allergies: ['Penicillin'] })).toBe(true);
        expect(Value.Check(patientManagedHealthProfileBodySchema, {
            chronic_condition_ids: [conditionId],
        })).toBe(true);
    });

    test('identity update responses contain no health data while GET composition remains compatible', () => {
        const dateOfBirth = new Date('1995-04-20T00:00:00.000Z');
        const patient = {
            _id: new mongoose.Types.ObjectId(),
            user_id: new mongoose.Types.ObjectId(),
            full_name: 'مريض',
            phone: null,
            gender: 'male',
            date_of_birth: dateOfBirth,
            address: null,
            profile_photo: null,
            status: 'active',
            createdAt: new Date(),
            updatedAt: new Date(),
        } as never;
        const conditionId = new mongoose.Types.ObjectId();
        const health = {
            blood_type: 'O+',
            allergies: ['Penicillin'],
            chronic_condition_ids: [conditionId],
        } as never;

        const identity = formatPatientIdentityResponse(patient);
        expect(identity).not.toHaveProperty('blood_group');
        expect(identity).not.toHaveProperty('allergies');
        expect(identity).not.toHaveProperty('chronic_condition_ids');
        expect(identity.date_of_birth).toBe('1995-04-20');
        expect(identity.age).toBe(calculateAge(dateOfBirth));

        expect(formatPatientResponse(patient, health)).toEqual(expect.objectContaining({
            blood_group: 'O+',
            allergies: ['Penicillin'],
            chronic_condition_ids: [conditionId.toString()],
        }));
    });

    test('health response composes patient DOB, derived age, and managed health fields', async () => {
        const dateOfBirth = new Date('2020-09-10T00:00:00.000Z');
        const patient = { date_of_birth: dateOfBirth } as never;
        const profile = {
            blood_type: 'A+',
            allergies: ['Latex'],
            chronic_condition_ids: [],
            updatedAt: new Date('2026-09-01T00:00:00.000Z'),
        } as never;

        expect(await formatPatientHealthResponse(patient, profile)).toEqual({
            date_of_birth: '2020-09-10',
            age: calculateAge(dateOfBirth),
            blood_type: 'A+',
            allergies: ['Latex'],
            chronic_conditions: [],
            updatedAt: new Date('2026-09-01T00:00:00.000Z'),
        });
    });
});
