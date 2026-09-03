import { t } from 'elysia';
import { AppointmentActorTypeEnum, AppointmentBeneficiaryTypeEnum, IAppointmentBookingSourceEnum, IAppointmentPaymentStatusEnum, IAppointmentStatusEnum } from '../interfaces/appointment.interface';
import { AvailabilityExceptionTypeEnum } from '../interfaces/doctor-availability.interface';
import { PaginationSchema } from './api-response.schema';

const nullableString = t.Nullable(t.String());
export const AppointmentSchema = t.Object({
    _id: t.String(), appointmentNumber: t.String(), patientId: t.String(), beneficiaryType: t.Enum(AppointmentBeneficiaryTypeEnum), childId: nullableString,
    doctorId: t.String(), clinicId: t.String(), specialtyId: nullableString, startsAt: t.String({ format: 'date-time' }), endsAt: t.String({ format: 'date-time' }),
    localDate: t.String({ format: 'date' }), localStartsAt: t.String(), localEndsAt: t.String(), timezone: t.Literal('Asia/Baghdad'), status: t.Enum(IAppointmentStatusEnum),
    bookingSource: t.Enum(IAppointmentBookingSourceEnum), reason: nullableString,
    doctor: t.Object({ display_name: t.String(), profile_photo: t.Optional(t.Nullable(t.String())) }),
    clinic: t.Object({ name: t.String(), address: t.String() }), specialty: t.Nullable(t.Object({ name: t.String() })),
    beneficiary: t.Object({ type: t.Enum(AppointmentBeneficiaryTypeEnum), display_name: t.String() }),
    pricing: t.Object({ fee: t.Number(), currency: t.String() }), paymentStatus: t.Enum(IAppointmentPaymentStatusEnum),
    rescheduledFrom: nullableString, rescheduledTo: nullableString,
    cancellation: t.Nullable(t.Object({ reason: nullableString, actorType: t.Enum(AppointmentActorTypeEnum), at: t.Date() })),
    capabilities: t.Optional(t.Object({ canCancel: t.Boolean(), canReschedule: t.Boolean() })), notesInternal: t.Optional(nullableString),
    createdAt: t.Date(), updatedAt: t.Date(),
}, { additionalProperties: false });
export const AppointmentResponseSchema = t.Object({ error: t.Literal(false), message: t.String(), data: AppointmentSchema });
export const AppointmentListResponseSchema = t.Object({ error: t.Literal(false), message: t.String(), data: t.Array(AppointmentSchema), pagination: PaginationSchema });
export const SlotSchema = t.Object({ startsAt: t.String({ format: 'date-time' }), endsAt: t.String({ format: 'date-time' }), localStartsAt: t.String(), localEndsAt: t.String(), blockedStartsAt: t.String({ format: 'date-time' }), blockedEndsAt: t.String({ format: 'date-time' }) });
export const SlotsResponseSchema = t.Object({ error: t.Literal(false), message: t.String(), data: t.Object({ doctorId: t.String(), clinicId: t.String(), date: t.String({ format: 'date' }), timezone: t.Literal('Asia/Baghdad'), slots: t.Array(SlotSchema) }) });
export const HistoryResponseSchema = t.Object({ error: t.Literal(false), message: t.String(), data: t.Array(t.Object({ eventType: t.String(), fromStatus: t.Nullable(t.String()), toStatus: t.Nullable(t.String()), actorType: t.String(), reason: nullableString, actorUserId: t.Optional(nullableString), metadata: t.Optional(t.Unknown()), createdAt: t.Date() })) });
export const PeriodSchema = t.Object({ start_time: t.String({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }), end_time: t.String({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }) }, { additionalProperties: false });
export const WeeklyDaySchema = t.Object({ day_of_week: t.Integer({ minimum: 0, maximum: 6 }), periods: t.Array(PeriodSchema, { maxItems: 12 }), is_active: t.Optional(t.Boolean()) }, { additionalProperties: false });
export const ExceptionBodySchema = t.Object({ clinic_id: t.Optional(t.Nullable(t.String())), local_date: t.String({ format: 'date' }), type: t.Enum(AvailabilityExceptionTypeEnum), periods: t.Optional(t.Array(PeriodSchema, { maxItems: 12 })), reason: t.Optional(t.Nullable(t.String({ maxLength: 1000 }))) }, { additionalProperties: false });
export const SettingsBodySchema = t.Object({ appointment_duration: t.Optional(t.Integer({ minimum: 5, maximum: 480 })), slot_interval: t.Optional(t.Integer({ minimum: 5, maximum: 480 })), buffer_before: t.Optional(t.Integer({ minimum: 0, maximum: 240 })), buffer_after: t.Optional(t.Integer({ minimum: 0, maximum: 240 })), booking_lead_time_hours: t.Optional(t.Number({ minimum: 0, maximum: 8760 })), cancellation_window_hours: t.Optional(t.Number({ minimum: 0, maximum: 8760 })), accept_auto_booking: t.Optional(t.Boolean()), allow_reschedule: t.Optional(t.Boolean()), accepting_new_patients: t.Optional(t.Boolean()) }, { additionalProperties: false, minProperties: 1 });
export const AvailabilitySchema = t.Object({ _id: t.String(), doctorId: t.String(), clinicId: t.String(), dayOfWeek: t.Integer(), periods: t.Array(PeriodSchema), isActive: t.Boolean(), createdAt: t.Date(), updatedAt: t.Date() });
export const AvailabilityListResponseSchema = t.Object({ error: t.Literal(false), message: t.String(), data: t.Array(AvailabilitySchema) });
export const ExceptionSchema = t.Object({ _id: t.String(), doctorId: t.String(), clinicId: nullableString, localDate: t.String({ format: 'date' }), type: t.Enum(AvailabilityExceptionTypeEnum), periods: t.Array(PeriodSchema), reason: nullableString, createdByType: t.Enum(AppointmentActorTypeEnum), createdAt: t.Date(), updatedAt: t.Date() });
export const ExceptionResponseSchema = t.Object({ error: t.Literal(false), message: t.String(), data: ExceptionSchema });
export const ExceptionListResponseSchema = t.Object({ error: t.Literal(false), message: t.String(), data: t.Array(ExceptionSchema) });
export const BookingSettingsSchema = t.Object({ appointmentDuration: t.Number(), slotInterval: t.Number(), bufferBefore: t.Number(), bufferAfter: t.Number(), bookingLeadTimeHours: t.Number(), cancellationWindowHours: t.Number(), acceptAutoBooking: t.Boolean(), allowReschedule: t.Boolean(), acceptingNewPatients: t.Boolean() });
export const BookingSettingsResponseSchema = t.Object({ error: t.Literal(false), message: t.String(), data: BookingSettingsSchema });
export const AppointmentCalendarResponseSchema = t.Object({ error: t.Literal(false), message: t.String(), data: t.Array(AppointmentSchema) });
export const AppointmentBeneficiarySchema = t.Union([
    t.Object({ type: t.Literal(AppointmentBeneficiaryTypeEnum.SELF) }, { additionalProperties: false }),
    t.Object({ type: t.Literal(AppointmentBeneficiaryTypeEnum.CHILD), childId: t.String() }, { additionalProperties: false }),
]);
export const PatientAppointmentCreateBodySchema = t.Object({
    doctorId: t.String(), clinicId: t.String(), specialtyId: t.Optional(t.Nullable(t.String())), date: t.String({ format: 'date' }),
    startsAt: t.String({ format: 'date-time' }), beneficiary: AppointmentBeneficiarySchema,
    reason: t.Optional(t.Nullable(t.String({ maxLength: 1000 }))),
}, { additionalProperties: false });
