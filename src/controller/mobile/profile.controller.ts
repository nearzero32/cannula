import Elysia, { t } from 'elysia';
import { SWAGGER_TAGS } from '../../constants/swagger-tags';
import mongoose from 'mongoose';
import { AuthPlugin } from '../../middleware/auth.middleware';
import patientService from '../../services/patient.service';
import userService from '../../services/user.service';
import {
    IPatientGenderEnum,
    type IPatient,
} from '../../interfaces/patient.interface';
import { IUserRoleEnum } from '../../interfaces/user.interface';
import { IActivityLogSourceEnum } from '../../interfaces/activity-log.interface';
import { BadRequestResponseSchema, ForbiddenResponseSchema, GenericDataResponseSchema, InternalServerErrorResponseSchema, NotFoundResponseSchema, ProtectedApiErrorResponses, ValidationErrorResponseSchema } from '../../schemas/api-response.schema';
import { patientHealthProfileService } from '../../services/health-profile.service';
import type { PatientHealthProfileDocument } from '../../models/patient-health-profile.model';
import { DomainError } from '../../services/domain-error';
import { calculateAge, formatDateOfBirth, parseDateOfBirth } from '../../services/date-of-birth';

const ObjectId = mongoose.Types.ObjectId;

export const completeProfileBodySchema = t.Object({
    full_name: t.Optional(t.String({ minLength: 2, maxLength: 120 })),
    email: t.Optional(t.Nullable(t.String())),
    gender: t.Optional(t.Nullable(t.Enum(IPatientGenderEnum))),
    date_of_birth: t.Optional(t.Nullable(t.String({
        format: 'date',
        description: 'تاريخ ميلاد ISO بصيغة YYYY-MM-DD؛ العمر مشتق وللقراءة فقط',
    }))),
    address: t.Optional(t.Nullable(t.String({ maxLength: 300 }))),
    profile_photo: t.Optional(t.Nullable(t.String())),
}, { additionalProperties: false });

function isProfileComplete(patient: IPatient): boolean {
    return Boolean(patient.gender && patient.date_of_birth);
}

export function formatPatientIdentityResponse(patient: IPatient) {
    return {
        _id: patient._id.toString(),
        user_id: patient.user_id.toString(),
        full_name: patient.full_name,
        phone: patient.phone,
        gender: patient.gender,
        date_of_birth: formatDateOfBirth(patient.date_of_birth),
        age: patient.date_of_birth ? calculateAge(patient.date_of_birth) : null,
        address: patient.address,
        profile_photo: patient.profile_photo,
        status: patient.status,
        profile_completed: isProfileComplete(patient),
    };
}

export function formatPatientResponse(patient: IPatient, health: PatientHealthProfileDocument) {
    return {
        ...formatPatientIdentityResponse(patient),
        blood_group: health.blood_type ?? null,
        allergies: health.allergies,
        chronic_condition_ids: health.chronic_condition_ids.map((id) => id.toString()),
    };
}

export const mobileProfileController = new Elysia({
    prefix: '/profile',
    detail: { tags: [SWAGGER_TAGS.MOBILE.PROFILE] },
})
    .use(AuthPlugin())

    .get('/', async ({ phrase, set }) => {
        if (phrase.role !== IUserRoleEnum.PATIENT) {
            set.status = 403;
            return { error: true, message: 'غير مصرح لك بالوصول' };
        }

        const patient = await patientService.getByUserId(phrase._id);
        if (!patient) {
            set.status = 404;
            return { error: true, message: 'الملف الشخصي غير موجود' };
        }

        return {
            error: false,
            message: 'تم جلب الملف الشخصي بنجاح',
            data: formatPatientResponse(
                patient,
                await patientHealthProfileService.getOrCreate(new ObjectId(patient._id.toString()))
            ),
        };
    }, {
        response: {
            200: GenericDataResponseSchema, 403: ForbiddenResponseSchema, 404: NotFoundResponseSchema,
            ...ProtectedApiErrorResponses,
        },
    })

    .patch(
        '/complete-profile',
        async ({ body, phrase, set }) => {
            if (phrase.role !== IUserRoleEnum.PATIENT) {
                set.status = 403;
                return { error: true, message: 'غير مصرح لك بالوصول' };
            }

            const patient = await patientService.getByUserId(phrase._id);
            if (!patient) {
                set.status = 404;
                return { error: true, message: 'الملف الشخصي غير موجود' };
            }

            let parsedDateOfBirth: Date | null | undefined;
            if (body.date_of_birth !== undefined) {
                try {
                    parsedDateOfBirth = body.date_of_birth ? parseDateOfBirth(body.date_of_birth) : null;
                } catch (error) {
                    if (error instanceof DomainError) {
                        set.status = error.status;
                        return { error: true, message: error.message };
                    }
                    throw error;
                }
            }

            const patientPayload: Record<string, unknown> = {};
            if (body.full_name !== undefined) patientPayload.full_name = body.full_name;
            if (body.gender !== undefined) patientPayload.gender = body.gender;
            if (body.date_of_birth !== undefined) {
                patientPayload.date_of_birth = parsedDateOfBirth;
            }
            if (body.address !== undefined) patientPayload.address = body.address;
            if (body.profile_photo !== undefined) patientPayload.profile_photo = body.profile_photo;

            const userPayload: Record<string, unknown> = {};
            if (body.full_name !== undefined) userPayload.full_name = body.full_name;
            if (body.email !== undefined) userPayload.email = body.email ?? undefined;

            const meta = {
                user_id: phrase._id,
                user_name: phrase.role + '_' + phrase._id,
                user_type: phrase.role,
                endpoint: '/mobile/profile/complete-profile',
                source: IActivityLogSourceEnum.MOBILE,
            };

            if (Object.keys(userPayload).length > 0) {
                await userService.update(phrase._id, userPayload, meta);
            }

            const updated = await patientService.update(
                patient._id.toString(),
                patientPayload,
                meta
            );

            if (!updated) {
                set.status = 500;
                return { error: true, message: 'فشل تحديث الملف الشخصي' };
            }

            return {
                error: false,
                message: 'تم إكمال الملف الشخصي بنجاح',
                data: formatPatientIdentityResponse(updated),
            };
        },
        {
            body: completeProfileBodySchema,
            detail: {
                description: 'يعدّل بيانات هوية المريض فقط: الاسم والبريد والجنس وتاريخ الميلاد والعنوان وصورة الملف. العمر مشتق ولا يُخزّن. فصيلة الدم والحساسيات والحالات المزمنة تُعدّل حصراً عبر /profile/health.',
            },
            response: {
                200: GenericDataResponseSchema, 400: BadRequestResponseSchema, 403: ForbiddenResponseSchema,
                404: NotFoundResponseSchema, 422: ValidationErrorResponseSchema,
                ...ProtectedApiErrorResponses, 500: InternalServerErrorResponseSchema,
            },
        }
    );
