import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import mongoose from 'mongoose';
import Patient from '../src/models/patients.model';
import Doctor from '../src/models/doctors.model';
import Nurse from '../src/models/nurse.model';
import Pharmacy from '../src/models/pharmacy.model';
import User from '../src/models/users.model';
import patientService from '../src/services/patient.service';
import doctorService from '../src/services/doctor.service';
import nurseService from '../src/services/nurse.service';
import pharmacyService from '../src/services/pharmacy.service';
import userService from '../src/services/user.service';
import sessionService from '../src/services/session.service';
import ActivityLogService from '../src/services/activity-log.service';
import { IPatientStatusEnum } from '../src/interfaces/patient.interface';
import { IDoctorStatusEnum } from '../src/interfaces/doctor.interface';
import { INurseStatusEnum } from '../src/interfaces/nurse.interface';
import { IPharmacyStatusEnum } from '../src/interfaces/pharmacy.interface';
import { IUserRoleEnum, IUserStatusEnum } from '../src/interfaces/user.interface';

const id = new mongoose.Types.ObjectId('507f1f77bcf86cd799439021');
const userId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439022');
const query = <T>(value: T) => ({ exec: async () => value });
const doc = (status: string) => ({ _id: id, user_id: userId, status, toObject() { return { _id: id, user_id: userId, status }; } });

afterEach(() => mock.restore());

describe('security-sensitive account mutations revoke logical sessions', () => {
    test('disabling Patient, Doctor, Nurse, and Pharmacy profiles revokes every user session', async () => {
        const revoke = spyOn(sessionService, 'revokeAll').mockResolvedValue(2);
        spyOn(ActivityLogService, 'logActivity').mockResolvedValue({} as never);

        spyOn(Patient, 'findById').mockReturnValue(query(doc(IPatientStatusEnum.ACTIVE)) as never);
        spyOn(Patient, 'findByIdAndUpdate').mockReturnValue(query(doc(IPatientStatusEnum.BLOCKED)) as never);
        await patientService.update(String(id), { status: IPatientStatusEnum.BLOCKED });

        spyOn(Doctor, 'findById').mockReturnValue(query(doc(IDoctorStatusEnum.ACTIVE)) as never);
        spyOn(Doctor, 'findByIdAndUpdate').mockReturnValue(query(doc(IDoctorStatusEnum.SUSPENDED)) as never);
        await doctorService.update(String(id), { status: IDoctorStatusEnum.SUSPENDED });

        spyOn(nurseService, 'getById').mockResolvedValue(doc(INurseStatusEnum.ACTIVE) as never);
        spyOn(Nurse, 'findByIdAndUpdate').mockReturnValue(query(doc(INurseStatusEnum.INACTIVE)) as never);
        await nurseService.update(String(id), { status: INurseStatusEnum.INACTIVE }, { user_id: String(id), endpoint: '/test' });

        spyOn(pharmacyService, 'getById').mockResolvedValue(doc(IPharmacyStatusEnum.ACTIVE) as never);
        spyOn(Pharmacy, 'findByIdAndUpdate').mockReturnValue(query(doc(IPharmacyStatusEnum.SUSPENDED)) as never);
        await pharmacyService.update(String(id), { status: IPharmacyStatusEnum.SUSPENDED }, String(id), '/test');

        expect(revoke).toHaveBeenCalledTimes(4);
        expect(revoke.mock.calls.map((call) => call[0])).toEqual([String(userId), String(userId), String(userId), String(userId)]);
        expect(revoke.mock.calls.map((call) => call[1]?.reasonCode)).toEqual([
            'PATIENT_STATUS_DISABLED', 'DOCTOR_STATUS_DISABLED', 'NURSE_STATUS_DISABLED', 'PHARMACY_STATUS_DISABLED',
        ]);
    });

    test('reactivating a profile does not create or restore a session', async () => {
        const revoke = spyOn(sessionService, 'revokeAll').mockResolvedValue(0);
        spyOn(ActivityLogService, 'logActivity').mockResolvedValue({} as never);
        spyOn(Patient, 'findById').mockReturnValue(query(doc(IPatientStatusEnum.BLOCKED)) as never);
        spyOn(Patient, 'findByIdAndUpdate').mockReturnValue(query(doc(IPatientStatusEnum.ACTIVE)) as never);
        await patientService.update(String(id), { status: IPatientStatusEnum.ACTIVE });
        expect(revoke).not.toHaveBeenCalled();
    });

    test('User disabling covers Admin and a role change revokes old-role sessions', async () => {
        const revoke = spyOn(sessionService, 'revokeAll').mockResolvedValue(1);
        spyOn(ActivityLogService, 'logActivity').mockResolvedValue({} as never);
        const oldUser = { _id: userId, role: IUserRoleEnum.ADMIN, status: IUserStatusEnum.ACTIVE, toObject() { return { _id: userId, role: this.role, status: this.status }; } };
        spyOn(User, 'findById').mockReturnValue(query(oldUser) as never);
        spyOn(User, 'findByIdAndUpdate')
            .mockReturnValueOnce(query({ ...oldUser, status: IUserStatusEnum.SUSPENDED }) as never)
            .mockReturnValueOnce(query({ ...oldUser, role: IUserRoleEnum.DOCTOR }) as never);

        await userService.update(String(userId), { status: IUserStatusEnum.SUSPENDED });
        await userService.update(String(userId), { role: IUserRoleEnum.DOCTOR });

        expect(revoke).toHaveBeenCalledTimes(2);
        expect(revoke.mock.calls[0]).toEqual([String(userId), { reasonCode: 'USER_STATUS_DISABLED' }]);
        expect(revoke.mock.calls[1]).toEqual([String(userId), { reasonCode: 'USER_ROLE_CHANGED' }]);
    });
});
