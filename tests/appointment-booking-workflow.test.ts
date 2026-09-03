import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import mongoose from 'mongoose';
import Appointment from '../src/models/appointments.model';
import AppointmentHistory from '../src/models/appointment-history.model';
import AppointmentCounter from '../src/models/appointment-counter.model';
import AppointmentDayLock from '../src/models/appointment-day-lock.model';
import Patient from '../src/models/patients.model';
import PatientChild from '../src/models/patient-child.model';
import { AppointmentWorkflowService } from '../src/services/appointment-workflow.service';
import { directAppointmentTransactionRunner } from '../src/services/appointment-transaction.service';
import { AppointmentActorTypeEnum, AppointmentBeneficiaryTypeEnum, IAppointmentBookingSourceEnum, IAppointmentStatusEnum } from '../src/interfaces/appointment.interface';

afterEach(() => mock.restore());

describe('Appointment booking workflow', () => {
    const patientId = new mongoose.Types.ObjectId(), childId = new mongoose.Types.ObjectId(), doctorId = new mongoose.Types.ObjectId(), clinicId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    let sequence = 0;
    let createdPayload: any;

    function arrange(options: { autoConfirm?: boolean; child?: any } = {}) {
        sequence = 0; createdPayload = undefined;
        spyOn(AppointmentDayLock, 'findOneAndUpdate').mockReturnValue({ exec: async () => ({ revision: 1 }) } as never);
        spyOn(AppointmentCounter, 'findOneAndUpdate').mockImplementation(() => ({ exec: async () => ({ sequence: ++sequence }) }) as never);
        spyOn(Patient, 'findById').mockReturnValue({ exec: async () => ({ _id: patientId, full_name: 'مريض أصلي', status: 'active' }) } as never);
        spyOn(PatientChild, 'findOne').mockReturnValue({ exec: async () => options.child ?? null } as never);
        spyOn(Appointment, 'create').mockImplementation(async (payload: any) => {
            createdPayload = payload;
            return { _id: new mongoose.Types.ObjectId(), ...payload, createdAt: new Date(), updatedAt: new Date() } as never;
        });
        spyOn(AppointmentHistory, 'create').mockResolvedValue({} as never);
        const slots = { requireSlot: async () => ({
            slot: { startsAt: '2026-09-10T06:00:00.000Z', endsAt: '2026-09-10T06:30:00.000Z', blockedStartsAt: '2026-09-10T05:50:00.000Z', blockedEndsAt: '2026-09-10T06:40:00.000Z' },
            context: { doctor: { _id: doctorId, display_name: 'الاسم المحفوظ', profile_photo: null, consultation_fee: 25000, currency: 'IQD', accept_auto_booking: options.autoConfirm ?? false }, clinic: { _id: clinicId, name: 'العيادة المحفوظة', address: 'بغداد' }, specialty: null },
        }) };
        return new AppointmentWorkflowService(directAppointmentTransactionRunner, slots as any);
    }

    const input = (beneficiary: any = { type: AppointmentBeneficiaryTypeEnum.SELF }) => ({
        patientId: String(patientId), doctorId: String(doctorId), clinicId: String(clinicId), date: '2026-09-10', startsAt: '2026-09-10T06:00:00.000Z', beneficiary,
        source: IAppointmentBookingSourceEnum.APP, bookedByUserId: String(userId), reason: 'فحص',
    });
    const actor = { type: AppointmentActorTypeEnum.PATIENT, userId: String(userId), patientId: String(patientId) };

    test('books SELF, computes end/buffer bounds, and snapshots fee and display values', async () => {
        const result = await arrange().create(input(), actor, new Date('2026-09-01T00:00:00Z'));
        expect(result.status).toBe(IAppointmentStatusEnum.PENDING);
        expect(createdPayload.ends_at.toISOString()).toBe('2026-09-10T06:30:00.000Z');
        expect(createdPayload.blocked_starts_at.toISOString()).toBe('2026-09-10T05:50:00.000Z');
        expect(createdPayload.snapshot).toEqual({ doctor: { display_name: 'الاسم المحفوظ', profile_photo: null }, clinic: { name: 'العيادة المحفوظة', address: 'بغداد' }, specialty: null, beneficiary: { type: 'SELF', display_name: 'مريض أصلي' }, pricing: { fee: 25000, currency: 'IQD' } });
        expect(createdPayload.appointment_number).toBe('APP-2026-000001');
    });

    test('books only an owned active CHILD and freezes the child name', async () => {
        const service = arrange({ child: { _id: childId, patient_id: patientId, full_name: 'طفل محفوظ', status: 'active' } });
        await service.create(input({ type: AppointmentBeneficiaryTypeEnum.CHILD, childId: String(childId) }), actor);
        expect(PatientChild.findOne).toHaveBeenCalledWith({ _id: childId, patient_id: patientId });
        expect(createdPayload.child_id).toEqual(childId);
        expect(createdPayload.snapshot.beneficiary).toEqual({ type: 'CHILD', display_name: 'طفل محفوظ' });
    });

    test('rejects a foreign or missing child before slot validation', async () => {
        const service = arrange();
        await expect(service.create(input({ type: AppointmentBeneficiaryTypeEnum.CHILD, childId: String(childId) }), actor)).rejects.toMatchObject({ status: 404, code: 'APPOINTMENT_NOT_OWNED' });
        expect(Appointment.create).not.toHaveBeenCalled();
    });

    test('rejects an inactive child', async () => {
        const service = arrange({ child: { _id: childId, patient_id: patientId, full_name: 'طفل', status: 'inactive' } });
        await expect(service.create(input({ type: AppointmentBeneficiaryTypeEnum.CHILD, childId: String(childId) }), actor)).rejects.toMatchObject({ status: 422, code: 'APPOINTMENT_BENEFICIARY_INVALID' });
    });

    test('doctor auto booking controls initial status unless Admin explicitly selects it', async () => {
        await arrange({ autoConfirm: true }).create(input(), actor);
        expect(createdPayload.status).toBe(IAppointmentStatusEnum.CONFIRMED);
        expect(createdPayload.confirmed_at).toBeInstanceOf(Date);
        const adminInput = { ...input(), initialStatus: IAppointmentStatusEnum.PENDING };
        await arrange({ autoConfirm: true }).create(adminInput, { type: AppointmentActorTypeEnum.ADMIN });
        expect(createdPayload.status).toBe(IAppointmentStatusEnum.PENDING);
    });

    test('atomic display-number counter is used rather than counting appointments', async () => {
        const service = arrange();
        const first = await service.create(input(), actor), second = await service.create(input(), actor);
        expect(first.appointment_number).toBe('APP-2026-000001');
        expect(second.appointment_number).toBe('APP-2026-000002');
        expect(AppointmentCounter.findOneAndUpdate).toHaveBeenCalledTimes(2);
    });
});
