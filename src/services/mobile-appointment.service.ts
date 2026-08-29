import mongoose from 'mongoose';
import appointmentService from './appointment.service';
import patientChildService, { calculateAge } from './patient-child.service';
import doctorService from './doctor.service';
import clinicService from './clinic.service';
import { DomainError } from './domain-error';
import { PatientChildStatusEnum } from '../interfaces/patient-child.interface';
import { IDoctorStatusEnum } from '../interfaces/doctor.interface';
import { IClinicStatusEnum } from '../interfaces/clinic.interface';
import {
    IAppointmentBookingSourceEnum,
    IAppointmentPaymentStatusEnum,
    IAppointmentStatusEnum,
} from '../interfaces/appointment.interface';
import type { PatientChildDocument } from '../models/patient-child.model';
import type { AppointmentDocument } from '../models/appointments.model';

export interface MobileAppointmentInput {
    doctor_id: string;
    clinic_id: string;
    specialty_id?: string | null;
    date: string;
    starts_at: string;
    ends_at: string;
    reason?: string | null;
    child_id?: string | null;
}

function objectId(value: string, message: string): mongoose.Types.ObjectId {
    if (!mongoose.Types.ObjectId.isValid(value)) throw new DomainError(message, 400);
    return new mongoose.Types.ObjectId(value);
}

export function validateAppointmentTime(dateText: string, startsAt: string, endsAt: string): Date {
    const date = new Date(`${dateText}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) throw new DomainError('تاريخ الموعد غير صالح', 400);
    if (date.getTime() < new Date().setUTCHours(0, 0, 0, 0)) {
        throw new DomainError('لا يمكن حجز موعد في تاريخ سابق', 422);
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startsAt) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(endsAt)) {
        throw new DomainError('وقت الموعد غير صالح', 400);
    }
    if (endsAt <= startsAt) throw new DomainError('وقت نهاية الموعد يجب أن يكون بعد وقت البداية', 400);
    return date;
}

export function formatMobileAppointment(appointment: AppointmentDocument, child: PatientChildDocument | null) {
    return {
        _id: appointment._id.toString(),
        appointment_number: appointment.appointment_number,
        patient_id: appointment.patient_id.toString(),
        child_id: appointment.child_id?.toString() ?? null,
        doctor_id: appointment.doctor_id.toString(),
        clinic_id: appointment.clinic_id.toString(),
        specialty_id: appointment.specialty_id?.toString() ?? null,
        date: appointment.date,
        starts_at: appointment.starts_at,
        ends_at: appointment.ends_at,
        status: appointment.status,
        booking_source: appointment.booking_source,
        reason: appointment.reason ?? null,
        appointment_fee: appointment.appointment_fee,
        beneficiary: child
            ? {
                type: 'CHILD' as const,
                child: {
                    _id: child._id.toString(),
                    full_name: child.full_name,
                    age: calculateAge(child.date_of_birth),
                },
            }
            : { type: 'SELF' as const },
    };
}

export class MobileAppointmentService {
    async create(
        patientId: mongoose.Types.ObjectId,
        authenticatedUserId: string,
        input: MobileAppointmentInput
    ) {
        const doctorId = objectId(input.doctor_id, 'معرف الطبيب غير صالح');
        const clinicId = objectId(input.clinic_id, 'معرف العيادة غير صالح');
        const specialtyId = input.specialty_id
            ? objectId(input.specialty_id, 'معرف التخصص غير صالح')
            : null;
        const date = validateAppointmentTime(input.date, input.starts_at, input.ends_at);

        const [doctor, clinic] = await Promise.all([
            doctorService.getById(doctorId.toString()),
            clinicService.getById(clinicId.toString()),
        ]);
        if (!doctor || doctor.status !== IDoctorStatusEnum.ACTIVE || !doctor.accepting_new_patients) {
            throw new DomainError('الطبيب غير متاح للحجز', 404);
        }
        if (!clinic || clinic.status !== IClinicStatusEnum.ACTIVE) {
            throw new DomainError('العيادة غير متاحة للحجز', 404);
        }
        if (!doctor.clinic_ids.some((id) => id.toString() === clinicId.toString())) {
            throw new DomainError('الطبيب غير مرتبط بهذه العيادة', 422);
        }

        let child: PatientChildDocument | null = null;
        if (input.child_id) {
            child = await patientChildService.requireOwnedChild(patientId, input.child_id);
            if (child.status !== PatientChildStatusEnum.ACTIVE) {
                throw new DomainError('لا يمكن الحجز لطفل غير فعال', 422);
            }
        }

        if (await appointmentService.isSlotTaken(doctorId.toString(), date, input.starts_at)) {
            throw new DomainError('هذا الموعد محجوز مسبقاً', 409);
        }

        const appointment = await appointmentService.create({
            patient_id: patientId,
            child_id: child ? new mongoose.Types.ObjectId(child._id.toString()) : null,
            doctor_id: doctorId,
            clinic_id: clinicId,
            specialty_id: specialtyId,
            date,
            starts_at: input.starts_at,
            ends_at: input.ends_at,
            status: IAppointmentStatusEnum.PENDING,
            booked_by: objectId(authenticatedUserId, 'معرف المستخدم غير صالح'),
            booking_source: IAppointmentBookingSourceEnum.APP,
            reason: input.reason?.trim() || null,
            payment_status: IAppointmentPaymentStatusEnum.UNPAID,
            appointment_fee: doctor.consultation_fee ?? 0,
        }, {
            user_id: authenticatedUserId,
            user_name: `patient_${authenticatedUserId}`,
            user_type: 'patient',
            endpoint: '/mobile/appointments',
            source: 'mobile',
        });
        return { appointment, child };
    }
}

export default new MobileAppointmentService();
