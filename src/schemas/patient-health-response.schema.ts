import { t } from 'elysia';
import { BloodTypeEnum } from '../interfaces/health-profile.interface';
import { IPatientGenderEnum } from '../interfaces/patient.interface';
import { PatientChildRelationshipEnum, PatientChildStatusEnum } from '../interfaces/patient-child.interface';
import { successResponse } from './api-response.schema';

const ChronicConditionSummarySchema = t.Object({
    _id: t.String(),
    name: t.String(),
});

export const HealthProfileDataSchema = t.Object({
    date_of_birth: t.Nullable(t.String({
        format: 'date',
        description: 'تاريخ الميلاد من ملف المريض؛ يُعدّل عبر نقطة نهاية الملف الشخصي',
    })),
    age: t.Nullable(t.Integer({ minimum: 0, description: 'العمر المحسوب ديناميكياً؛ للقراءة فقط' })),
    blood_type: t.Nullable(t.Enum(BloodTypeEnum)),
    allergies: t.Array(t.String()),
    chronic_conditions: t.Array(ChronicConditionSummarySchema),
    updatedAt: t.Date(),
});

export const HealthProfileResponseSchema = successResponse(
    HealthProfileDataSchema,
    'ملف صحي للمريض أو الطفل'
);

export const PatientChildDataSchema = t.Object({
    _id: t.String(),
    full_name: t.String(),
    date_of_birth: t.String({ format: 'date', description: 'تاريخ ميلاد ISO بصيغة YYYY-MM-DD' }),
    age: t.Integer({ minimum: 0, description: 'العمر المحسوب ديناميكياً' }),
    gender: t.Enum(IPatientGenderEnum),
    relationship: t.Enum(PatientChildRelationshipEnum, {
        description: 'صلة القرابة الوصفية؛ تبقى صلاحية الإدارة قائمة على ملكية سجل الطفل',
    }),
    photo: t.Nullable(t.String()),
    status: t.Enum(PatientChildStatusEnum),
    createdAt: t.Date(),
    updatedAt: t.Date(),
});

export const PatientChildResponseSchema = successResponse(PatientChildDataSchema, 'بيانات الطفل');
export const PatientChildrenResponseSchema = successResponse(
    t.Array(PatientChildDataSchema),
    'قائمة أطفال المريض'
);

export const ChildHealthProfileDataSchema = t.Composite([
    t.Pick(PatientChildDataSchema, [
        '_id', 'full_name', 'date_of_birth', 'age', 'gender', 'relationship', 'photo', 'status',
    ]),
    t.Omit(HealthProfileDataSchema, ['date_of_birth', 'age']),
]);

export const ChildHealthProfileResponseSchema = successResponse(
    ChildHealthProfileDataSchema,
    'بيانات الطفل وملفه الصحي'
);

export const AppointmentBeneficiarySchema = t.Union([
    t.Object({ type: t.Literal('SELF') }),
    t.Object({
        type: t.Literal('CHILD'),
        child: t.Object({
            _id: t.String(),
            full_name: t.String(),
            age: t.Integer({ minimum: 0 }),
        }),
    }),
]);

export const MobileAppointmentDataSchema = t.Object({
    _id: t.String(),
    appointment_number: t.String(),
    patient_id: t.String(),
    child_id: t.Nullable(t.String()),
    doctor_id: t.String(),
    clinic_id: t.String(),
    specialty_id: t.Nullable(t.String()),
    date: t.Date(),
    starts_at: t.String(),
    ends_at: t.String(),
    status: t.String(),
    booking_source: t.String(),
    reason: t.Nullable(t.String()),
    appointment_fee: t.Number(),
    beneficiary: AppointmentBeneficiarySchema,
});

export const MobileAppointmentResponseSchema = successResponse(
    MobileAppointmentDataSchema,
    'موعد المريض مع المستفيد'
);
