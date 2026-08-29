import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import mongoose from 'mongoose';
import Patient from '../src/models/patients.model';
import PatientHealthProfile from '../src/models/patient-health-profile.model';
import patientService from '../src/services/patient.service';
import ActivityLogService from '../src/services/activity-log.service';

afterEach(() => mock.restore());

describe('Patient health profile creation', () => {
    const patientId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');
    const userId = new mongoose.Types.ObjectId('507f191e810c19729de860ea');

    function patientDocument() {
        return {
            _id: patientId,
            user_id: userId,
            full_name: 'مريض',
            status: 'active',
            toObject: () => ({ _id: patientId, user_id: userId, full_name: 'مريض' }),
        };
    }

    test('new patient creation also creates an empty health profile', async () => {
        const patient = patientDocument();
        spyOn(Patient, 'create').mockResolvedValue(patient as never);
        const profileCreate = spyOn(PatientHealthProfile, 'create').mockResolvedValue({ patient_id: patientId } as never);
        spyOn(ActivityLogService, 'logActivity').mockResolvedValue({} as never);
        const created = await patientService.create({ user_id: userId, full_name: 'مريض' });
        expect(created._id.toString()).toBe(patientId.toString());
        expect(profileCreate).toHaveBeenCalledWith({ patient_id: patientId });
    });

    test('rolls back a newly created patient if profile creation fails', async () => {
        const patient = patientDocument();
        spyOn(Patient, 'create').mockResolvedValue(patient as never);
        spyOn(PatientHealthProfile, 'create').mockRejectedValue(new Error('profile failure'));
        const rollback = spyOn(Patient, 'findByIdAndDelete').mockReturnValue({ exec: async () => patient } as never);
        await expect(patientService.create({ user_id: userId, full_name: 'مريض' })).rejects.toThrow('profile failure');
        expect(rollback).toHaveBeenCalledWith(patientId);
    });
});
