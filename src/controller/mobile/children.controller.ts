import Elysia, { t } from 'elysia';
import { SWAGGER_TAGS } from '../../constants/swagger-tags';
import mongoose from 'mongoose';
import { AuthPlugin } from '../../middleware/auth.middleware';
import patientService from '../../services/patient.service';
import patientChildService, { formatPatientChild } from '../../services/patient-child.service';
import { formatHealthProfile } from '../../services/health-profile.service';
import { DomainError } from '../../services/domain-error';
import { IUserRoleEnum } from '../../interfaces/user.interface';
import { IPatientGenderEnum } from '../../interfaces/patient.interface';
import { PatientChildStatusEnum } from '../../interfaces/patient-child.interface';
import { healthProfileBodySchema } from './profile-health.controller';
import {
    BadRequestResponseSchema,
    ForbiddenResponseSchema,
    NotFoundResponseSchema,
    ProtectedApiErrorResponses,
    ValidationErrorResponseSchema,
} from '../../schemas/api-response.schema';
import {
    HealthProfileResponseSchema,
    PatientChildResponseSchema,
    PatientChildrenResponseSchema,
} from '../../schemas/patient-health-response.schema';

const childCreateBodySchema = t.Object({
    full_name: t.String({ minLength: 1, maxLength: 120 }),
    date_of_birth: t.String({ format: 'date', description: 'تاريخ ميلاد ISO بصيغة YYYY-MM-DD' }),
    gender: t.Enum(IPatientGenderEnum),
    photo: t.Optional(t.Nullable(t.String())),
}, { additionalProperties: false });

const childUpdateBodySchema = t.Partial(childCreateBodySchema);

async function requirePatient(phrase: { _id: string; role: string }) {
    if (phrase.role !== IUserRoleEnum.PATIENT) throw new DomainError('غير مصرح لك بالوصول', 403);
    const patient = await patientService.getByUserId(phrase._id);
    if (!patient) throw new DomainError('الملف الشخصي غير موجود', 404);
    return new mongoose.Types.ObjectId(patient._id.toString());
}

function handleDomainError(error: unknown, set: { status?: number | string }) {
    if (!(error instanceof DomainError)) throw error;
    set.status = error.status;
    return { error: true as const, message: error.message };
}

export const mobileChildrenController = new Elysia({
    prefix: '/children',
    detail: { tags: [SWAGGER_TAGS.MOBILE.CHILDREN] },
})
    .use(AuthPlugin())
    .get('/', async ({ query, phrase, set }) => {
        try {
            const patientId = await requirePatient(phrase);
            const children = await patientChildService.list(patientId, query.include_inactive === true);
            return { error: false, message: 'تم جلب الأطفال بنجاح', data: children.map(formatPatientChild) };
        } catch (error) {
            return handleDomainError(error, set);
        }
    }, {
        query: t.Object({ include_inactive: t.Optional(t.Boolean()) }),
        response: {
            200: PatientChildrenResponseSchema,
            400: BadRequestResponseSchema,
            403: ForbiddenResponseSchema,
            404: NotFoundResponseSchema,
            422: ValidationErrorResponseSchema,
            ...ProtectedApiErrorResponses,
        },
    })
    .post('/', async ({ body, phrase, set }) => {
        try {
            const patientId = await requirePatient(phrase);
            const child = await patientChildService.create(patientId, {
                ...body,
                date_of_birth: new Date(`${body.date_of_birth}T00:00:00.000Z`),
            });
            set.status = 201;
            return { error: false, message: 'تم إضافة الطفل بنجاح', data: formatPatientChild(child) };
        } catch (error) {
            return handleDomainError(error, set);
        }
    }, {
        body: childCreateBodySchema,
        response: {
            201: PatientChildResponseSchema,
            400: BadRequestResponseSchema,
            403: ForbiddenResponseSchema,
            404: NotFoundResponseSchema,
            422: ValidationErrorResponseSchema,
            ...ProtectedApiErrorResponses,
        },
    })
    .get('/:childId', async ({ params, phrase, set }) => {
        try {
            const child = await patientChildService.requireOwnedChild(await requirePatient(phrase), params.childId);
            return { error: false, message: 'تم جلب بيانات الطفل بنجاح', data: formatPatientChild(child) };
        } catch (error) {
            return handleDomainError(error, set);
        }
    }, {
        params: t.Object({ childId: t.String() }),
        response: {
            200: PatientChildResponseSchema,
            400: BadRequestResponseSchema,
            403: ForbiddenResponseSchema,
            404: NotFoundResponseSchema,
            ...ProtectedApiErrorResponses,
        },
    })
    .patch('/:childId', async ({ params, body, phrase, set }) => {
        try {
            const child = await patientChildService.update(await requirePatient(phrase), params.childId, {
                ...body,
                date_of_birth: body.date_of_birth
                    ? new Date(`${body.date_of_birth}T00:00:00.000Z`)
                    : undefined,
            });
            if (!child) throw new DomainError('الطفل غير موجود', 404);
            return { error: false, message: 'تم تحديث بيانات الطفل بنجاح', data: formatPatientChild(child) };
        } catch (error) {
            return handleDomainError(error, set);
        }
    }, {
        params: t.Object({ childId: t.String() }),
        body: childUpdateBodySchema,
        response: {
            200: PatientChildResponseSchema,
            400: BadRequestResponseSchema,
            403: ForbiddenResponseSchema,
            404: NotFoundResponseSchema,
            422: ValidationErrorResponseSchema,
            ...ProtectedApiErrorResponses,
        },
    })
    .patch('/:childId/status', async ({ params, body, phrase, set }) => {
        try {
            const child = await patientChildService.updateStatus(
                await requirePatient(phrase), params.childId, body.status
            );
            if (!child) throw new DomainError('الطفل غير موجود', 404);
            return { error: false, message: 'تم تحديث حالة الطفل بنجاح', data: formatPatientChild(child) };
        } catch (error) {
            return handleDomainError(error, set);
        }
    }, {
        params: t.Object({ childId: t.String() }),
        body: t.Object({ status: t.Enum(PatientChildStatusEnum) }),
        response: {
            200: PatientChildResponseSchema,
            400: BadRequestResponseSchema,
            403: ForbiddenResponseSchema,
            404: NotFoundResponseSchema,
            422: ValidationErrorResponseSchema,
            ...ProtectedApiErrorResponses,
        },
    })
    .get('/:childId/health-profile', async ({ params, phrase, set }) => {
        try {
            const { profile } = await patientChildService.getOwnedHealthProfile(
                await requirePatient(phrase), params.childId
            );
            return {
                error: false,
                message: 'تم جلب الملف الصحي للطفل بنجاح',
                data: await formatHealthProfile(profile),
            };
        } catch (error) {
            return handleDomainError(error, set);
        }
    }, {
        params: t.Object({ childId: t.String() }),
        response: {
            200: HealthProfileResponseSchema,
            400: BadRequestResponseSchema,
            403: ForbiddenResponseSchema,
            404: NotFoundResponseSchema,
            ...ProtectedApiErrorResponses,
        },
    })
    .patch('/:childId/health-profile', async ({ params, body, phrase, set }) => {
        try {
            const { profile } = await patientChildService.updateOwnedHealthProfile(
                await requirePatient(phrase), params.childId, body
            );
            return {
                error: false,
                message: 'تم تحديث الملف الصحي للطفل بنجاح',
                data: await formatHealthProfile(profile),
            };
        } catch (error) {
            return handleDomainError(error, set);
        }
    }, {
        params: t.Object({ childId: t.String() }),
        body: healthProfileBodySchema,
        response: {
            200: HealthProfileResponseSchema,
            400: BadRequestResponseSchema,
            403: ForbiddenResponseSchema,
            404: NotFoundResponseSchema,
            422: ValidationErrorResponseSchema,
            ...ProtectedApiErrorResponses,
        },
    });
