import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import mongoose from 'mongoose';
import { Value } from '@sinclair/typebox/value';
import Appointment from '../src/models/appointments.model';
import Doctor from '../src/models/doctors.model';
import patientService from '../src/services/patient.service';
import appointmentService, { formatAppointment } from '../src/services/appointment.service';
import appointmentSlotService from '../src/services/appointment-slot.service';
import appointmentWorkflowService from '../src/services/appointment-workflow.service';
import sessionService from '../src/services/session.service';
import { mobileAppointmentsController } from '../src/controller/mobile/appointments.controller';
import {
    AppointmentActorTypeEnum,
    AppointmentBeneficiaryTypeEnum,
    IAppointmentBookingSourceEnum,
    IAppointmentPaymentStatusEnum,
    IAppointmentStatusEnum,
} from '../src/interfaces/appointment.interface';
import { IUserRoleEnum } from '../src/interfaces/user.interface';
import { signAccessToken, TokenAudienceEnum } from '../src/constants/jwt';
import { AppointmentListResponseSchema, AppointmentResponseSchema, AppointmentSchema, HistoryResponseSchema } from '../src/schemas/appointment-response.schema';

const patientId = new mongoose.Types.ObjectId('507f191e810c19729de86101');
const userId = new mongoose.Types.ObjectId('507f191e810c19729de86102');
const doctorId = new mongoose.Types.ObjectId('507f191e810c19729de86103');
const clinicId = new mongoose.Types.ObjectId('507f191e810c19729de86104');
const specialtyId = new mongoose.Types.ObjectId('507f191e810c19729de86105');
const childId = new mongoose.Types.ObjectId('507f191e810c19729de86106');

function persistedAppointment(overrides: Record<string, unknown> = {}) {
    return {
        _id: new mongoose.Types.ObjectId('507f191e810c19729de86110'),
        appointment_number: 'APP-2026-000001',
        patient_id: patientId,
        beneficiary_type: AppointmentBeneficiaryTypeEnum.SELF,
        child_id: null,
        doctor_id: doctorId,
        clinic_id: clinicId,
        specialty_id: null,
        local_date: '2026-09-20',
        starts_at: new Date('2026-09-20T06:00:00.000Z'),
        ends_at: new Date('2026-09-20T06:30:00.000Z'),
        blocked_starts_at: new Date('2026-09-20T05:50:00.000Z'),
        blocked_ends_at: new Date('2026-09-20T06:40:00.000Z'),
        status: IAppointmentStatusEnum.PENDING,
        booking_source: IAppointmentBookingSourceEnum.APP,
        reason: null,
        notes_internal: null,
        snapshot: {
            doctor: { display_name: 'د. اختبار', profile_photo: null },
            clinic: { name: 'عيادة الاختبار', address: 'بغداد' },
            specialty: null,
            beneficiary: { type: AppointmentBeneficiaryTypeEnum.SELF, display_name: 'مريض الاختبار' },
            pricing: { fee: 25000, currency: 'IQD' },
        },
        payment_status: IAppointmentPaymentStatusEnum.UNPAID,
        cancellation: null,
        rescheduled_from: null,
        rescheduled_to: null,
        workflow_version: 0,
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        updatedAt: new Date('2026-09-01T00:00:00.000Z'),
        ...overrides,
    };
}

describe('Appointment persistence and response contract regression', () => {
    test('new Appointment documents default cancellation to explicit null', () => {
        const appointment = new Appointment(persistedAppointment({ _id: undefined, createdAt: undefined, updatedAt: undefined }));
        expect(appointment.cancellation).toBeNull();
        expect(appointment.toObject().cancellation).toBeNull();
        expect(appointment.validateSync()).toBeUndefined();
    });

    test('cancellation subdocument rejects incomplete new values and accepts complete values', () => {
        const incomplete = new Appointment(persistedAppointment({ _id: undefined, cancellation: { reason: null } }));
        const incompletePaths = Object.keys(incomplete.validateSync()?.errors ?? {});
        expect(incompletePaths).toContain('cancellation.actor_type');
        expect(incompletePaths).toContain('cancellation.at');

        const complete = new Appointment(persistedAppointment({
            _id: undefined,
            status: IAppointmentStatusEnum.CANCELLED,
            cancellation: { reason: 'طلب المريض', actor_type: AppointmentActorTypeEnum.PATIENT, actor_user_id: userId, at: new Date('2026-09-10T00:00:00.000Z') },
        }));
        expect(complete.validateSync()).toBeUndefined();
        expect(complete.cancellation?.actor_user_id).toEqual(userId);
    });

    test('formatter stays aligned with the strict schema for lifecycle and beneficiary variants', () => {
        const cases = [
            persistedAppointment(),
            persistedAppointment({ status: IAppointmentStatusEnum.CONFIRMED }),
            persistedAppointment({
                status: IAppointmentStatusEnum.CANCELLED,
                cancellation: { reason: 'تعذر الحضور', actor_type: AppointmentActorTypeEnum.PATIENT, actor_user_id: userId, at: new Date('2026-09-10T00:00:00.000Z') },
            }),
            persistedAppointment({ status: IAppointmentStatusEnum.RESCHEDULED, rescheduled_to: new mongoose.Types.ObjectId() }),
            persistedAppointment({ specialty_id: specialtyId, snapshot: { ...persistedAppointment().snapshot, specialty: { name: 'باطنية' } } }),
            persistedAppointment({
                beneficiary_type: AppointmentBeneficiaryTypeEnum.CHILD,
                child_id: childId,
                snapshot: { ...persistedAppointment().snapshot, beneficiary: { type: AppointmentBeneficiaryTypeEnum.CHILD, display_name: 'طفل الاختبار' } },
            }),
        ];

        for (const appointment of cases) {
            expect(Value.Check(AppointmentSchema, formatAppointment(appointment)), appointment.status).toBe(true);
        }

        const staff = formatAppointment(cases[0], {
            includeInternal: true,
            dailyCapacity: { max: 30, booked: 1, remaining: 29, reached: false },
        });
        expect(Value.Check(AppointmentSchema, staff)).toBe(true);
        expect(staff.notesInternal).toBeNull();
    });

    test('legacy malformed cancellation values normalize to null without fabricated metadata', () => {
        for (const cancellation of [{ reason: null }, { actor_type: AppointmentActorTypeEnum.PATIENT }, { actor_type: AppointmentActorTypeEnum.PATIENT, at: null }, { actor_type: 'LEGACY', at: new Date() }, { actor_type: AppointmentActorTypeEnum.ADMIN, at: 'not-a-date' }]) {
            const dto = formatAppointment(persistedAppointment({ cancellation }));
            expect(dto.cancellation).toBeNull();
            expect(Value.Check(AppointmentSchema, dto)).toBe(true);
        }
    });

    test('valid cancellation maps actor_type and Date without exposing actor_user_id', () => {
        const at = new Date('2026-09-10T00:00:00.000Z');
        const dto = formatAppointment(persistedAppointment({
            status: IAppointmentStatusEnum.CANCELLED,
            cancellation: { reason: 'طلب المريض', actor_type: AppointmentActorTypeEnum.PATIENT, actor_user_id: userId, at },
        }));
        expect(dto.cancellation).toEqual({ reason: 'طلب المريض', actorType: AppointmentActorTypeEnum.PATIENT, at });
        expect(dto.cancellation).not.toHaveProperty('actor_user_id');
        expect(Value.Check(AppointmentSchema, dto)).toBe(true);
    });

    test('list, detail, staff, doctor, and history envelopes accept normalized Date values', () => {
        const patientDto = formatAppointment(persistedAppointment(), { capabilities: { canCancel: true, canReschedule: false } });
        const staffDto = formatAppointment(persistedAppointment(), { includeInternal: true, dailyCapacity: { max: 30, booked: 1, remaining: 29, reached: false } });
        expect(Value.Check(AppointmentResponseSchema, { error: false, message: 'ok', data: patientDto })).toBe(true);
        expect(Value.Check(AppointmentListResponseSchema, { error: false, message: 'ok', data: [patientDto, staffDto], pagination: { page: 1, limit: 20, total: 2, pages: 1, hasNext: false, hasPrev: false } })).toBe(true);
        expect(Value.Check(HistoryResponseSchema, { error: false, message: 'ok', data: [{ eventType: 'CREATED', fromStatus: null, toStatus: 'pending', actorType: 'PATIENT', reason: null, createdAt: new Date() }] })).toBe(true);
    });

    test('OpenAPI source schema keeps cancellation required and object-or-null', () => {
        const cancellation = AppointmentSchema.properties.cancellation as any;
        expect(AppointmentSchema.required).toContain('cancellation');
        expect(cancellation.anyOf).toBeArrayOfSize(2);
        expect(cancellation.anyOf.map((branch: any) => branch.type)).toEqual(expect.arrayContaining(['object', 'null']));
    });
});

describe('Mobile Appointment successful-write response regression', () => {
    beforeEach(() => {
        process.env.ACCESS_TOKEN_SECRET = 'test-access-secret-that-is-long-enough';
        spyOn(sessionService, 'validateAccess').mockImplementation(async payload => ({ sid: payload.sid, userId: payload._id, role: payload.role, audience: payload.aud, restricted: false, currentRefreshDigest: 'hash', createdAt: '', lastSeenAt: '', lastRefreshedAt: '', expiresAt: '' }));
    });
    afterEach(() => mock.restore());

    test.each([
        [AppointmentBeneficiaryTypeEnum.SELF, { type: AppointmentBeneficiaryTypeEnum.SELF }],
        [AppointmentBeneficiaryTypeEnum.CHILD, { type: AppointmentBeneficiaryTypeEnum.CHILD, childId: String(childId) }],
    ] as const)('books the exact advertised %s slot and returns a valid 201 after persistence succeeds', async (beneficiaryType, beneficiary) => {
        const advertisedStartsAt = '2026-09-20T06:00:00.000Z';
        const appointment = persistedAppointment({
            cancellation: { reason: null },
            ...(beneficiaryType === AppointmentBeneficiaryTypeEnum.CHILD ? {
                beneficiary_type: AppointmentBeneficiaryTypeEnum.CHILD,
                child_id: childId,
                snapshot: { ...persistedAppointment().snapshot, beneficiary: { type: AppointmentBeneficiaryTypeEnum.CHILD, display_name: 'طفل الاختبار' } },
            } : {}),
        });
        let successfulWrites = 0;
        spyOn(patientService, 'getByUserId').mockResolvedValue({ _id: patientId } as never);
        spyOn(appointmentSlotService, 'getAvailability').mockResolvedValue({
            doctorId: String(doctorId), clinicId: String(clinicId), date: '2026-09-20', timezone: 'Asia/Baghdad', availabilityStatus: 'AVAILABLE',
            dailyCapacity: { max: 30, booked: 0, remaining: 30, reached: false, availableSlotCount: 1, bookableRemaining: 1 },
            slots: [{ startsAt: advertisedStartsAt, endsAt: '2026-09-20T06:30:00.000Z', localStartsAt: '09:00', localEndsAt: '09:30' }],
            nextAvailable: null, nextAvailableOptions: [], context: {},
        } as never);
        const create = spyOn(appointmentWorkflowService, 'create').mockImplementation(async input => {
            expect(input.startsAt).toBe(advertisedStartsAt);
            successfulWrites += 1;
            return appointment as never;
        });
        spyOn(Doctor, 'find').mockReturnValue({ select() { return this; }, exec: async () => [] } as never);

        const token = signAccessToken({ _id: String(userId), role: IUserRoleEnum.PATIENT, sid: '12345678-1234-4234-8234-123456789012', audience: TokenAudienceEnum.MOBILE });
        const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
        const availabilityResponse = await mobileAppointmentsController.handle(new Request(`http://localhost/appointments/availability?doctorId=${doctorId}&clinicId=${clinicId}&date=2026-09-20`, { headers }));
        const availability = await availabilityResponse.json() as any;
        const response = await mobileAppointmentsController.handle(new Request('http://localhost/appointments/', {
            method: 'POST', headers, body: JSON.stringify({ doctorId: String(doctorId), clinicId: String(clinicId), specialtyId: null, date: '2026-09-20', startsAt: availability.data.slots[0].startsAt, beneficiary, reason: null }),
        }));
        const body = await response.json() as any;

        expect(availabilityResponse.status).toBe(200);
        expect(response.status).toBe(201);
        expect(successfulWrites).toBe(1);
        expect(create).toHaveBeenCalledTimes(1);
        expect(body.data.cancellation).toBeNull();
        expect(Value.Check(AppointmentResponseSchema, body)).toBe(true);
    });

    test('mobile list, detail, and history normalize malformed legacy cancellation', async () => {
        const legacy = persistedAppointment({ cancellation: { reason: null } });
        spyOn(patientService, 'getByUserId').mockResolvedValue({ _id: patientId } as never);
        spyOn(appointmentService, 'list').mockResolvedValue({ data: [legacy], count: 1, page: 1, limit: 20 } as never);
        spyOn(appointmentService, 'patientAppointment').mockResolvedValue(legacy as never);
        spyOn(appointmentService, 'history').mockResolvedValue([{ eventType: 'CREATED', fromStatus: null, toStatus: 'pending', actorType: 'PATIENT', reason: null, createdAt: new Date() }] as never);
        spyOn(Doctor, 'find').mockReturnValue({ select() { return this; }, exec: async () => [] } as never);
        const token = signAccessToken({ _id: String(userId), role: IUserRoleEnum.PATIENT, sid: '12345678-1234-4234-8234-123456789012', audience: TokenAudienceEnum.MOBILE });
        const headers = { authorization: `Bearer ${token}` };

        const list = await mobileAppointmentsController.handle(new Request('http://localhost/appointments/', { headers }));
        const detail = await mobileAppointmentsController.handle(new Request(`http://localhost/appointments/${legacy._id}`, { headers }));
        const history = await mobileAppointmentsController.handle(new Request(`http://localhost/appointments/${legacy._id}/history`, { headers }));
        const listBody = await list.json() as any;
        const detailBody = await detail.json() as any;
        const historyBody = await history.json() as any;

        expect([list.status, detail.status, history.status]).toEqual([200, 200, 200]);
        expect(listBody.data[0].cancellation).toBeNull();
        expect(detailBody.data.cancellation).toBeNull();
        expect(Value.Check(AppointmentListResponseSchema, listBody)).toBe(true);
        expect(Value.Check(AppointmentResponseSchema, detailBody)).toBe(true);
        expect(Value.Check(HistoryResponseSchema, historyBody)).toBe(true);
    });
});
