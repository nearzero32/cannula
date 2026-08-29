import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import mongoose from 'mongoose';
import { MobileAppointmentService, validateAppointmentTime } from '../src/services/mobile-appointment.service';
import patientChildService from '../src/services/patient-child.service';
import doctorService from '../src/services/doctor.service';
import clinicService from '../src/services/clinic.service';
import appointmentService from '../src/services/appointment.service';
import { PatientChildStatusEnum } from '../src/interfaces/patient-child.interface';
import { IDoctorStatusEnum } from '../src/interfaces/doctor.interface';
import { IClinicStatusEnum } from '../src/interfaces/clinic.interface';

afterEach(() => mock.restore());

describe('Mobile appointment beneficiaries', () => {
    const patientId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');
    const childId = new mongoose.Types.ObjectId('507f191e810c19729de860ea');
    const doctorId = new mongoose.Types.ObjectId('507f191e810c19729de860eb');
    const clinicId = new mongoose.Types.ObjectId('507f191e810c19729de860ec');
    const userId = '507f191e810c19729de860ed';
    const input = {
        doctor_id: doctorId.toString(),
        clinic_id: clinicId.toString(),
        date: '2099-01-01',
        starts_at: '09:00',
        ends_at: '09:30',
    };

    function mockAvailableBooking() {
        spyOn(doctorService, 'getById').mockResolvedValue({
            status: IDoctorStatusEnum.ACTIVE,
            accepting_new_patients: true,
            clinic_ids: [clinicId],
            consultation_fee: 25000,
        } as never);
        spyOn(clinicService, 'getById').mockResolvedValue({ status: IClinicStatusEnum.ACTIVE } as never);
        spyOn(appointmentService, 'isSlotTaken').mockResolvedValue(false);
        spyOn(appointmentService, 'create').mockImplementation(async (payload) => payload as never);
    }

    test('keeps child_id optional for self appointments', async () => {
        mockAvailableBooking();
        const result = await new MobileAppointmentService().create(patientId, userId, input);
        expect(result.child).toBeNull();
        expect(result.appointment.child_id).toBeNull();
    });

    test('stores an owned active child as beneficiary', async () => {
        mockAvailableBooking();
        const child = { _id: childId, status: PatientChildStatusEnum.ACTIVE };
        const owned = spyOn(patientChildService, 'requireOwnedChild').mockResolvedValue(child as never);
        const result = await new MobileAppointmentService().create(patientId, userId, {
            ...input,
            child_id: childId.toString(),
        });
        expect(owned).toHaveBeenCalledWith(patientId, childId.toString());
        expect(result.appointment.child_id?.toString()).toBe(childId.toString());
    });

    test('rejects foreign children using the ownership service', async () => {
        mockAvailableBooking();
        spyOn(patientChildService, 'requireOwnedChild').mockRejectedValue(new Error('الطفل غير موجود'));
        await expect(new MobileAppointmentService().create(patientId, userId, {
            ...input,
            child_id: childId.toString(),
        })).rejects.toThrow('الطفل غير موجود');
        expect(appointmentService.create).not.toHaveBeenCalled();
    });

    test('rejects inactive children for new appointments', async () => {
        mockAvailableBooking();
        spyOn(patientChildService, 'requireOwnedChild').mockResolvedValue({
            _id: childId,
            status: PatientChildStatusEnum.INACTIVE,
        } as never);
        await expect(new MobileAppointmentService().create(patientId, userId, {
            ...input,
            child_id: childId.toString(),
        })).rejects.toThrow('غير فعال');
        expect(appointmentService.create).not.toHaveBeenCalled();
    });

    test('validates date and time without weakening existing slot checks', () => {
        expect(() => validateAppointmentTime('2000-01-01', '09:00', '09:30')).toThrow('تاريخ سابق');
        expect(() => validateAppointmentTime('2099-01-01', '09:30', '09:00')).toThrow('بعد وقت البداية');
    });
});
