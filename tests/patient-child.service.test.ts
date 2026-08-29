import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import mongoose from 'mongoose';
import PatientChild from '../src/models/patient-child.model';
import ChildHealthProfile from '../src/models/child-health-profile.model';
import patientChildService, {
    calculateAge,
    ownedChildFilter,
} from '../src/services/patient-child.service';
import { IPatientGenderEnum } from '../src/interfaces/patient.interface';

afterEach(() => mock.restore());

describe('Patient child ownership and lifecycle', () => {
    const patientId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');
    const childId = new mongoose.Types.ObjectId('507f191e810c19729de860ea');

    test('builds every owned lookup from child id plus authenticated patient id', () => {
        expect(ownedChildFilter(patientId, childId.toString())).toEqual({ _id: childId, patient_id: patientId });
        expect(ownedChildFilter(patientId, 'invalid')).toBeNull();
    });

    test('foreign and nonexistent children use the same not-found result', async () => {
        const findOne = spyOn(PatientChild, 'findOne').mockReturnValue({ exec: async () => null } as never);
        await expect(patientChildService.requireOwnedChild(patientId, childId.toString()))
            .rejects.toThrow('الطفل غير موجود');
        expect(findOne).toHaveBeenCalledWith({ _id: childId, patient_id: patientId });
    });

    test('lists only the authenticated patient active children by default in creation order', async () => {
        let sort: object | undefined;
        const find = spyOn(PatientChild, 'find').mockReturnValue({
            sort(value: object) { sort = value; return this; },
            exec: async () => [],
        } as never);
        await patientChildService.list(patientId);
        expect(find).toHaveBeenCalledWith({ patient_id: patientId, status: 'active' });
        expect(sort).toEqual({ createdAt: 1 });
    });

    test('creating a child automatically creates exactly one health profile', async () => {
        const child = {
            _id: childId,
            patient_id: patientId,
            full_name: 'محمد أحمد',
            date_of_birth: new Date('2020-01-01'),
            gender: IPatientGenderEnum.MALE,
            status: 'active',
        };
        spyOn(PatientChild, 'create').mockResolvedValue(child as never);
        const createProfile = spyOn(ChildHealthProfile, 'create').mockResolvedValue({ child_id: childId } as never);
        const result = await patientChildService.create(patientId, {
            full_name: '  محمد أحمد  ',
            date_of_birth: new Date('2020-01-01'),
            gender: IPatientGenderEnum.MALE,
        });
        expect(result._id.toString()).toBe(childId.toString());
        expect(createProfile).toHaveBeenCalledTimes(1);
        expect(createProfile).toHaveBeenCalledWith({ child_id: childId });
    });

    test('rolls back a newly created child if its health profile cannot be created', async () => {
        const child = { _id: childId };
        spyOn(PatientChild, 'create').mockResolvedValue(child as never);
        spyOn(ChildHealthProfile, 'create').mockRejectedValue(new Error('profile failure'));
        const rollback = spyOn(PatientChild, 'findByIdAndDelete').mockReturnValue({ exec: async () => child } as never);
        await expect(patientChildService.create(patientId, {
            full_name: 'طفل',
            date_of_birth: new Date('2020-01-01'),
            gender: IPatientGenderEnum.FEMALE,
        })).rejects.toThrow('profile failure');
        expect(rollback).toHaveBeenCalledWith(childId);
    });

    test('calculates age dynamically around the birthday', () => {
        expect(calculateAge(new Date('2020-09-10T00:00:00Z'), new Date('2026-09-09T00:00:00Z'))).toBe(5);
        expect(calculateAge(new Date('2020-09-10T00:00:00Z'), new Date('2026-09-10T00:00:00Z'))).toBe(6);
    });
});
