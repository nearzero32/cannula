import Elysia, { t } from 'elysia';
import { SWAGGER_TAGS } from '../../constants/swagger-tags';
import mongoose from 'mongoose';
import { AuthPlugin } from '../../middleware/auth.middleware';
import patientService from '../../services/patient.service';
import {
    ALLERGY_MAX_LENGTH,
    formatHealthProfile,
    MAX_ALLERGIES,
    MAX_CHRONIC_CONDITIONS,
    patientHealthProfileService,
} from '../../services/health-profile.service';
import { DomainError } from '../../services/domain-error';
import { BloodTypeEnum } from '../../interfaces/health-profile.interface';
import { IUserRoleEnum } from '../../interfaces/user.interface';
import {
    BadRequestResponseSchema,
    ForbiddenResponseSchema,
    NotFoundResponseSchema,
    ProtectedApiErrorResponses,
    ValidationErrorResponseSchema,
} from '../../schemas/api-response.schema';
import { HealthProfileResponseSchema } from '../../schemas/patient-health-response.schema';
import { calculateAge, formatDateOfBirth } from '../../services/date-of-birth';
import type { IPatient } from '../../interfaces/patient.interface';
import type { PatientHealthProfileDocument } from '../../models/patient-health-profile.model';

export const patientManagedHealthProfileBodySchema = t.Object({
    blood_type: t.Optional(t.Nullable(t.Enum(BloodTypeEnum))),
    allergies: t.Optional(t.Array(t.String({ minLength: 1, maxLength: ALLERGY_MAX_LENGTH }), {
        maxItems: MAX_ALLERGIES,
        description: 'حساسيات يبلّغ عنها المريض؛ تُزال التكرارات دون اعتبار لحالة الأحرف',
    })),
    chronic_condition_ids: t.Optional(t.Array(t.String(), {
        maxItems: MAX_CHRONIC_CONDITIONS,
        description: 'معرفات حالات مزمنة نشطة ومدعومة؛ تستخدم القائمة البديلة و[] للمسح',
    })),
}, { additionalProperties: false });

async function authenticatedPatient(phrase: { _id: string; role: string }) {
    if (phrase.role !== IUserRoleEnum.PATIENT) throw new DomainError('غير مصرح لك بالوصول', 403);
    const patient = await patientService.getByUserId(phrase._id);
    if (!patient) throw new DomainError('الملف الشخصي غير موجود', 404);
    return patient;
}

export async function formatPatientHealthResponse(
    patient: IPatient,
    profile: PatientHealthProfileDocument
) {
    return {
        date_of_birth: formatDateOfBirth(patient.date_of_birth),
        age: patient.date_of_birth ? calculateAge(patient.date_of_birth) : null,
        ...await formatHealthProfile(profile),
    };
}

export const mobileProfileHealthController = new Elysia({
    prefix: '/profile/health',
    detail: { tags: [SWAGGER_TAGS.MOBILE.HEALTH_PROFILE] },
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
        const profile = await patientHealthProfileService.getOrCreate(
            new mongoose.Types.ObjectId(patient._id.toString())
        );
        return {
            error: false,
            message: 'تم جلب الملف الصحي بنجاح',
            data: await formatPatientHealthResponse(patient, profile),
        };
    }, {
        response: {
            200: HealthProfileResponseSchema,
            403: ForbiddenResponseSchema,
            404: NotFoundResponseSchema,
            ...ProtectedApiErrorResponses,
        },
    })
    .patch('/', async ({ body, phrase, set }) => {
        try {
            const patient = await authenticatedPatient(phrase);
            const profile = await patientHealthProfileService.update(
                new mongoose.Types.ObjectId(patient._id.toString()),
                body
            );
            return {
                error: false,
                message: 'تم تحديث الملف الصحي بنجاح',
                data: await formatPatientHealthResponse(patient, profile),
            };
        } catch (error) {
            if (error instanceof DomainError) {
                set.status = error.status;
                return { error: true, message: error.message };
            }
            throw error;
        }
    }, {
        body: patientManagedHealthProfileBodySchema,
        detail: {
            description: 'يعدّل المريض فصيلة الدم والحساسيات والحالات المزمنة فقط. تاريخ الميلاد يُعدّل عبر الملف الشخصي، والعمر مشتق للقراءة فقط. الأدوية والقياسات والملاحظات السريرية غير قابلة للكتابة من المريض.',
        },
        response: {
            200: HealthProfileResponseSchema,
            400: BadRequestResponseSchema,
            403: ForbiddenResponseSchema,
            404: NotFoundResponseSchema,
            422: ValidationErrorResponseSchema,
            ...ProtectedApiErrorResponses,
        },
    });
