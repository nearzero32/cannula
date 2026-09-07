import { t } from 'elysia';
import { MedicationDoseStatusEnum } from '../interfaces/medication-dose.interface';
import { PatientMedicationStatusEnum } from '../interfaces/patient-medication.interface';
import { successResponse } from './api-response.schema';

export const MedicationScheduleSchema = t.Object({
    timezone: t.String({ examples: ['Asia/Baghdad'] }),
    weekdays: t.Array(t.Integer({ minimum: 0, maximum: 6 }), { minItems: 1, maxItems: 7, examples: [[0, 2, 4]] }),
    times: t.Array(t.String({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }), { minItems: 1, maxItems: 8, examples: [['08:00', '20:00']] }),
    start_date: t.String({ format: 'date' }), end_date: t.Nullable(t.String({ format: 'date' })),
}, { additionalProperties: false });

export const MedicationScheduleInputSchema = t.Object({
    timezone: t.Optional(t.String({ maxLength: 100, default: 'Asia/Baghdad' })),
    weekdays: t.Optional(t.Array(t.Integer({ minimum: 0, maximum: 6 }), { minItems: 1, maxItems: 7 })),
    times: t.Array(t.String({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }), { minItems: 1, maxItems: 8 }),
    start_date: t.String({ format: 'date' }), end_date: t.Optional(t.Nullable(t.String({ format: 'date' }))),
}, { additionalProperties: false });

export const MedicationCreateBodySchema = t.Object({
    name: t.String({ minLength: 1, maxLength: 120 }), strength_text: t.Optional(t.Nullable(t.String({ maxLength: 120 }))),
    dose_instructions: t.Optional(t.Nullable(t.String({ maxLength: 500 }))), notes: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
    schedule: MedicationScheduleInputSchema, reminders_enabled: t.Optional(t.Boolean({ default: true })),
}, { additionalProperties: false, examples: [{ name: 'دواء موصوف', strength_text: '500 mg', dose_instructions: '1 tablet', schedule: { timezone: 'Asia/Baghdad', weekdays: [0,1,2,3,4,5,6], times: ['08:00','20:00'], start_date: '2026-09-07', end_date: null }, reminders_enabled: true }] });

const schedulePatch = t.Partial(MedicationScheduleInputSchema, { minProperties: 1 });
export const MedicationUpdateBodySchema = t.Partial(t.Object({
    name: t.String({ minLength: 1, maxLength: 120 }), strength_text: t.Nullable(t.String({ maxLength: 120 })),
    dose_instructions: t.Nullable(t.String({ maxLength: 500 })), notes: t.Nullable(t.String({ maxLength: 2000 })),
    schedule: schedulePatch, reminders_enabled: t.Boolean(),
}, { additionalProperties: false }), { minProperties: 1 });

export const MedicationSchema = t.Object({
    id: t.String(), name: t.String(), strength_text: t.Nullable(t.String()), dose_instructions: t.Nullable(t.String()), notes: t.Nullable(t.String()),
    schedule: MedicationScheduleSchema, reminders_enabled: t.Boolean(), schedule_version: t.Integer({ minimum: 1 }),
    next_dose_at: t.Nullable(t.Date()), status: t.Enum(PatientMedicationStatusEnum), createdAt: t.Date(), updatedAt: t.Date(),
});
export const MedicationResponseSchema = successResponse(MedicationSchema);
export const MedicationListResponseSchema = successResponse(t.Array(MedicationSchema));

export const MedicationDoseSchema = t.Object({
    id: t.String(), medication_id: t.String(), medication: t.Object({ name: t.String(), strength_text: t.Nullable(t.String()), dose_instructions: t.Nullable(t.String()) }),
    scheduled_at: t.Date(), schedule_version: t.Integer(), status: t.Enum(MedicationDoseStatusEnum), taken_at: t.Nullable(t.Date()), recorded_at: t.Nullable(t.Date()),
});
export const MedicationDoseResponseSchema = successResponse(MedicationDoseSchema);
export const MedicationDoseListResponseSchema = successResponse(t.Array(MedicationDoseSchema));
export const MedicationReminderSyncResponseSchema = successResponse(t.Object({
    generated_at: t.Date(), window_ends_at: t.Date(),
    schedules: t.Array(t.Object({ medication_id: t.String(), schedule_version: t.Integer(), timezone: t.String() })),
    reminders: t.Array(t.Object({ dose_id: t.String(), medication_id: t.String(), scheduled_at: t.Date(), timezone: t.String(), schedule_version: t.Integer(), title: t.String(), body: t.String() })),
}), 'مزامنة تذكيرات الجهاز المحلية؛ لا يرسل الخادم هذه التذكيرات عبر OneSignal');

