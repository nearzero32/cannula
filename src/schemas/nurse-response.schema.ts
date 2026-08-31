import { t } from 'elysia';
import { INurseGenderEnum, INurseStatusEnum } from '../interfaces/nurse.interface';
import { paginatedResponse, successResponse } from './api-response.schema';

const nullableString = t.Nullable(t.String());
export const NurseQualifiedServiceSchema = t.Object({
    _id: t.String(), name: t.String(), status: t.String(), category_id: t.String(),
});
export const NurseSchema = t.Object({
    _id: t.String(), user_id: t.String(), full_name: t.String(),
    gender: t.Optional(t.Nullable(t.Enum(INurseGenderEnum))), profile_photo: nullableString,
    specialty: nullableString, license_number: t.Optional(nullableString), license_verified: t.Boolean(),
    experience_years: t.Nullable(t.Number()), qualified_services: t.Array(NurseQualifiedServiceSchema),
    status: t.Enum(INurseStatusEnum),
    createdAt: t.Optional(t.String()), updatedAt: t.Optional(t.String()),
});
export const NurseResponseSchema = successResponse(NurseSchema, 'تم جلب بيانات الممرض بنجاح');
export const NurseListResponseSchema = paginatedResponse(NurseSchema, 'تم جلب الممرضين بنجاح');

export const HomeCareHistorySchema = t.Object({
    _id: t.String(), request_id: t.String(), request_number: t.String(), event_type: t.String(),
    actor: t.Object({ type: t.String(), user_id: t.Nullable(t.String()), nurse_id: t.Nullable(t.String()) }),
    from_status: nullableString, to_status: nullableString,
    from_nurse_id: nullableString, to_nurse_id: nullableString,
    dispatch_mode: nullableString, reason: nullableString, createdAt: t.String(),
});
export const HomeCareHistoryListResponseSchema = successResponse(t.Array(HomeCareHistorySchema), 'تم جلب سجل الطلب بنجاح');
