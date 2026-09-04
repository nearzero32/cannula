import { describe, expect, test } from 'bun:test';
import { PUBLIC_DOCTOR_MATCH, publicDoctorMatch } from '../src/services/doctor.service';

describe('public doctor visibility', () => {
    test('requires active, verified, and licensed profiles but not accepting new patients', () => {
        expect(PUBLIC_DOCTOR_MATCH).toEqual({ status: 'active', verification_status: 'verified', license_verified: true });
        expect(publicDoctorMatch('doctor')).toEqual({
            'doctor.status': 'active',
            'doctor.verification_status': 'verified',
            'doctor.license_verified': true,
        });
        expect(PUBLIC_DOCTOR_MATCH).not.toHaveProperty('accepting_new_patients');
    });
});
