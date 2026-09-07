import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { mobileController } from '../src/controller/mobile/index';
import { signAccessToken, TokenAudienceEnum } from '../src/constants/jwt';
import sessionService from '../src/services/session.service';
import patientMedicationService from '../src/services/patient-medication.service';
import patientService from '../src/services/patient.service';
import mongoose from 'mongoose';

const id = '507f191e810c19729de86401';
function request(role: 'patient' | 'doctor', path = '/mobile/medications', init: RequestInit = {}) {
    const token = signAccessToken({ _id: id, role, sid: '12345678-1234-4234-8234-123456789012', audience: TokenAudienceEnum.MOBILE });
    return new Request(`http://localhost${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
}

beforeEach(() => spyOn(sessionService, 'validateAccess').mockImplementation(async payload => ({ sid: payload.sid, userId: payload._id, role: payload.role, audience: payload.aud, restricted: false, currentRefreshDigest: 'hash', createdAt: '', lastSeenAt: '', lastRefreshedAt: '', expiresAt: '' })));
afterEach(() => mock.restore());

describe('Medication mobile authentication and abuse boundary', () => {
    test('unauthenticated access is rejected before medication service', async () => {
        const list = spyOn(patientMedicationService, 'list');
        const response = await mobileController.handle(new Request('http://localhost/mobile/medications'));
        expect(response.status).toBe(401);
        expect(list).not.toHaveBeenCalled();
    });

    test('wrong role is rejected by shared patient role guard', async () => {
        const list = spyOn(patientMedicationService, 'list');
        const response = await mobileController.handle(request('doctor'));
        expect(response.status).toBe(403);
        expect(list).not.toHaveBeenCalled();
    });

    test('patient_id in create body cannot influence authenticated ownership', async () => {
        const patientId = new mongoose.Types.ObjectId();
        spyOn(patientService, 'getByUserId').mockResolvedValue({ _id: patientId } as never);
        const medicationId = new mongoose.Types.ObjectId();
        const create = spyOn(patientMedicationService, 'create').mockResolvedValue({ _id: medicationId, patient_id: patientId } as never);
        spyOn(patientMedicationService, 'get').mockResolvedValue({ id: String(medicationId), name: 'x', strength_text: null, dose_instructions: null, notes: null, schedule: { timezone: 'Asia/Baghdad', weekdays: [0,1,2,3,4,5,6], times: ['08:00'], start_date: '2026-09-07', end_date: null }, reminders_enabled: true, schedule_version: 1, next_dose_at: null, status: 'active', createdAt: new Date(), updatedAt: new Date() } as never);
        const response = await mobileController.handle(request('patient', '/mobile/medications', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ patient_id: '507f191e810c19729de86402', name: 'x', schedule: { times: ['08:00'], start_date: '2026-09-07' } }) }));
        expect(response.status).toBe(201);
        expect(create).toHaveBeenCalledTimes(1);
        expect(String(create.mock.calls[0]![0])).toBe(String(patientId));
        expect(create.mock.calls[0]![1]).not.toHaveProperty('patient_id');
    });
});
