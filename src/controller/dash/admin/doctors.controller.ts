import Elysia, { t } from 'elysia';
import { SWAGGER_TAGS } from '../../../constants/swagger-tags';
import { AuthPlugin } from '../../../middleware/auth.middleware';
import mongoose from 'mongoose';
import doctorService from '../../../services/doctor.service';
import {
    IDoctorGenderEnum,
    IDoctorStatusEnum,
    IDoctorVerificationStatusEnum,
} from '../../../interfaces/doctor.interface';
import { BadRequestResponseSchema, ConflictResponseSchema, GenericDataResponseSchema, GenericPaginatedResponseSchema, NotFoundResponseSchema, ProtectedApiErrorResponses, ValidationErrorResponseSchema } from '../../../schemas/api-response.schema';
import { AdminPermissionGuardPlugin } from '../../../middleware/authorization.middleware';
import { IAdminPermissionEnum } from '../../../interfaces/admin.interface';

const ObjectId = mongoose.Types.ObjectId;

const doctorBodySchema = t.Object({
    user_id: t.String({ minLength: 1 }),
    full_name: t.String({ minLength: 1, maxLength: 120 }),
    display_name: t.String({ minLength: 1, maxLength: 120 }),
    gender: t.Optional(t.Nullable(t.Enum(IDoctorGenderEnum))),
    profile_photo: t.Optional(t.Nullable(t.String())),
    bio: t.Optional(t.Nullable(t.String({ maxLength: 1500 }))),
    specialty: t.String({ minLength: 1 }),
    sub_specialties: t.Optional(t.Array(t.String())),
    languages: t.Optional(t.Array(t.String())),
    experience_years: t.Optional(t.Nullable(t.Number({ minimum: 0 }))),
    license_number: t.Optional(t.Nullable(t.String({ maxLength: 100 }))),
    clinic_ids: t.Optional(t.Array(t.String())),
    map_location: t.Optional(
        t.Nullable(
            t.Object({
                lat: t.Optional(t.Nullable(t.Number())),
                lng: t.Optional(t.Nullable(t.Number())),
            })
        )
    ),
    consultation_fee: t.Optional(t.Nullable(t.Number({ minimum: 0 }))),
    follow_up_fee: t.Optional(t.Nullable(t.Number({ minimum: 0 }))),
    currency: t.Optional(t.Nullable(t.String({ maxLength: 10 }))),
    assistant_ids: t.Optional(t.Array(t.String())),
    is_featured: t.Optional(t.Boolean()),
    status: t.Optional(t.Enum(IDoctorStatusEnum)),
    notes_internal: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
});

const doctorUpdateSchema = t.Partial(
    t.Object({
        full_name: t.String({ minLength: 1, maxLength: 120 }),
        display_name: t.String({ minLength: 1, maxLength: 120 }),
        gender: t.Nullable(t.Enum(IDoctorGenderEnum)),
        profile_photo: t.Nullable(t.String()),
        bio: t.Nullable(t.String({ maxLength: 1500 })),
        specialty: t.String({ minLength: 1 }),
        sub_specialties: t.Array(t.String()),
        languages: t.Array(t.String()),
        experience_years: t.Nullable(t.Number({ minimum: 0 })),
        license_number: t.Nullable(t.String({ maxLength: 100 })),
        license_verified: t.Boolean(),
        verification_status: t.Enum(IDoctorVerificationStatusEnum),
        clinic_ids: t.Array(t.String()),
        map_location: t.Nullable(
            t.Object({
                lat: t.Nullable(t.Number()),
                lng: t.Nullable(t.Number()),
            })
        ),
        consultation_fee: t.Nullable(t.Number({ minimum: 0 })),
        follow_up_fee: t.Nullable(t.Number({ minimum: 0 })),
        currency: t.Nullable(t.String({ maxLength: 10 })),
        assistant_ids: t.Array(t.String()),
        is_featured: t.Boolean(),
        notes_internal: t.Nullable(t.String({ maxLength: 2000 })),
    })
);

export const doctorsController = new Elysia({
    prefix: '/doctors',
    detail: { tags: [SWAGGER_TAGS.ADMIN.DOCTORS] },
})
    .use(AuthPlugin())
    .use(AdminPermissionGuardPlugin((request) => new URL(request.url).pathname.endsWith('/verification')
        ? IAdminPermissionEnum.VERIFY_DOCTORS
        : IAdminPermissionEnum.MANAGE_DOCTORS))

    .get(
        '/',
        async ({ query }) => {
            const page = Math.max(1, Number(query.page) || 1);
            const limit = Math.min(100, Math.max(1, Number(query.limit) || 10));

            const main_match: Record<string, unknown> = {};

            if (query.status) main_match.status = query.status;
            if (query.verification_status) main_match.verification_status = query.verification_status;
            if (query.specialty) main_match.specialty = query.specialty;
            if (query.clinic_id && ObjectId.isValid(query.clinic_id))
                main_match.clinic_ids = new ObjectId(query.clinic_id);

            if (query.search) {
                main_match.$or = [
                    { full_name: { $regex: query.search, $options: 'i' } },
                    { display_name: { $regex: query.search, $options: 'i' } },
                    { specialty: { $regex: query.search, $options: 'i' } },
                    { license_number: { $regex: query.search, $options: 'i' } },
                ];
            }

            const { data, count } = await doctorService.getPaginated({ main_match, page, limit });
            const totalPages = Math.ceil(count / limit);

            return {
                error: false,
                message: 'تم جلب الأطباء بنجاح',
                data,
                pagination: { page, limit, total: count, pages: totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
            };
        },
        {
            query: t.Object({
                page: t.Optional(t.String()),
                limit: t.Optional(t.String()),
                status: t.Optional(t.Enum(IDoctorStatusEnum)),
                verification_status: t.Optional(t.Enum(IDoctorVerificationStatusEnum)),
                specialty: t.Optional(t.String()),
                clinic_id: t.Optional(t.String()),
                search: t.Optional(t.String()),
            }),
            response: { 200: GenericPaginatedResponseSchema, 422: ValidationErrorResponseSchema, ...ProtectedApiErrorResponses },
        }
    )

    .get(
        '/:id',
        async ({ params, set }) => {
            if (!ObjectId.isValid(params.id)) {
                set.status = 400;
                return { error: true, message: 'معرف الطبيب غير صالح' };
            }

            const doctor = await doctorService.getById(params.id);
            if (!doctor) {
                set.status = 404;
                return { error: true, message: 'الطبيب غير موجود' };
            }

            return { error: false, message: 'تم جلب الطبيب بنجاح', data: doctor };
        },
        {
            params: t.Object({ id: t.String() }),
            response: { 200: GenericDataResponseSchema, 400: BadRequestResponseSchema, 404: NotFoundResponseSchema, ...ProtectedApiErrorResponses },
        }
    )

    .post(
        '/',
        async ({ body, phrase, set }) => {
            if (!ObjectId.isValid(body.user_id)) {
                set.status = 400;
                return { error: true, message: 'معرف المستخدم غير صالح' };
            }

            const existing = await doctorService.getByUserId(body.user_id);
            if (existing) {
                set.status = 409;
                return { error: true, message: 'هذا المستخدم مسجل كطبيب مسبقاً' };
            }

            if (body.clinic_ids?.some((id) => !ObjectId.isValid(id))) {
                set.status = 400;
                return { error: true, message: 'معرف عيادة غير صالح' };
            }

            if (body.assistant_ids?.some((id) => !ObjectId.isValid(id))) {
                set.status = 400;
                return { error: true, message: 'معرف مساعد غير صالح' };
            }

            const doctor = await doctorService.create(
                {
                    user_id: new ObjectId(body.user_id),
                    full_name: body.full_name,
                    display_name: body.display_name,
                    gender: body.gender,
                    profile_photo: body.profile_photo,
                    bio: body.bio,
                    specialty: body.specialty,
                    sub_specialties: body.sub_specialties ?? [],
                    languages: body.languages ?? [],
                    experience_years: body.experience_years,
                    license_number: body.license_number,
                    clinic_ids: body.clinic_ids?.map((id) => new ObjectId(id)) ?? [],
                    map_location: body.map_location,
                    consultation_fee: body.consultation_fee,
                    follow_up_fee: body.follow_up_fee,
                    currency: body.currency ?? 'IQD',
                    assistant_ids: body.assistant_ids?.map((id) => new ObjectId(id)) ?? [],
                    is_featured: body.is_featured ?? false,
                    status: body.status ?? IDoctorStatusEnum.DRAFT,
                    notes_internal: body.notes_internal,
                },
                {
                    user_id: phrase._id,
                    user_name: phrase.role + '_' + phrase._id,
                    user_type: phrase.role,
                    endpoint: '/dash/admin/doctors',
                    source: 'dashboard',
                }
            );

            set.status = 201;
            return { error: false, message: 'تم إنشاء الطبيب بنجاح', data: doctor };
        },
        {
            body: doctorBodySchema,
            response: {
                201: GenericDataResponseSchema, 400: BadRequestResponseSchema, 409: ConflictResponseSchema,
                422: ValidationErrorResponseSchema, ...ProtectedApiErrorResponses,
            },
        }
    )

    .put(
        '/:id',
        async ({ params, body, phrase, set }) => {
            if (!ObjectId.isValid(params.id)) {
                set.status = 400;
                return { error: true, message: 'معرف الطبيب غير صالح' };
            }

            const doctor = await doctorService.getById(params.id);
            if (!doctor) {
                set.status = 404;
                return { error: true, message: 'الطبيب غير موجود' };
            }

            if (body.clinic_ids?.some((id) => !ObjectId.isValid(id))) {
                set.status = 400;
                return { error: true, message: 'معرف عيادة غير صالح' };
            }

            if (body.assistant_ids?.some((id) => !ObjectId.isValid(id))) {
                set.status = 400;
                return { error: true, message: 'معرف مساعد غير صالح' };
            }

            const payload: Record<string, unknown> = {};
            if (body.full_name !== undefined) payload.full_name = body.full_name;
            if (body.display_name !== undefined) payload.display_name = body.display_name;
            if (body.gender !== undefined) payload.gender = body.gender;
            if (body.profile_photo !== undefined) payload.profile_photo = body.profile_photo;
            if (body.bio !== undefined) payload.bio = body.bio;
            if (body.specialty !== undefined) payload.specialty = body.specialty;
            if (body.sub_specialties !== undefined) payload.sub_specialties = body.sub_specialties;
            if (body.languages !== undefined) payload.languages = body.languages;
            if (body.experience_years !== undefined) payload.experience_years = body.experience_years;
            if (body.license_number !== undefined) payload.license_number = body.license_number;
            if (body.license_verified !== undefined) payload.license_verified = body.license_verified;
            if (body.verification_status !== undefined) payload.verification_status = body.verification_status;
            if (body.clinic_ids !== undefined) payload.clinic_ids = body.clinic_ids.map((id) => new ObjectId(id));
            if (body.map_location !== undefined) payload.map_location = body.map_location;
            if (body.consultation_fee !== undefined) payload.consultation_fee = body.consultation_fee;
            if (body.follow_up_fee !== undefined) payload.follow_up_fee = body.follow_up_fee;
            if (body.currency !== undefined) payload.currency = body.currency;
            if (body.assistant_ids !== undefined) payload.assistant_ids = body.assistant_ids.map((id) => new ObjectId(id));
            if (body.is_featured !== undefined) payload.is_featured = body.is_featured;
            if (body.notes_internal !== undefined) payload.notes_internal = body.notes_internal;

            const updated = await doctorService.update(params.id, payload, {
                user_id: phrase._id,
                user_name: phrase.role + '_' + phrase._id,
                user_type: phrase.role,
                endpoint: '/dash/admin/doctors/' + params.id,
                source: 'dashboard',
            });
            return { error: false, message: 'تم تحديث الطبيب بنجاح', data: updated };
        },
        {
            params: t.Object({ id: t.String() }),
            body: doctorUpdateSchema,
            response: { 200: GenericDataResponseSchema, 400: BadRequestResponseSchema, 404: NotFoundResponseSchema, 422: ValidationErrorResponseSchema, ...ProtectedApiErrorResponses },
        }
    )

    .patch(
        '/:id/status',
        async ({ params, body, phrase, set }) => {
            if (!ObjectId.isValid(params.id)) {
                set.status = 400;
                return { error: true, message: 'معرف الطبيب غير صالح' };
            }

            const doctor = await doctorService.getById(params.id);
            if (!doctor) {
                set.status = 404;
                return { error: true, message: 'الطبيب غير موجود' };
            }

            const updated = await doctorService.update(params.id, { status: body.status }, {
                user_id: phrase._id,
                user_name: phrase.role + '_' + phrase._id,
                user_type: phrase.role,
                endpoint: '/dash/admin/doctors/' + params.id + '/status',
                source: 'dashboard',
            });
            return { error: false, message: 'تم تحديث حالة الطبيب بنجاح', data: updated };
        },
        {
            params: t.Object({ id: t.String() }),
            body: t.Object({ status: t.Enum(IDoctorStatusEnum) }),
            response: { 200: GenericDataResponseSchema, 400: BadRequestResponseSchema, 404: NotFoundResponseSchema, 422: ValidationErrorResponseSchema, ...ProtectedApiErrorResponses },
        }
    )

    .patch(
        '/:id/verification',
        async ({ params, body, phrase, set }) => {
            if (!ObjectId.isValid(params.id)) {
                set.status = 400;
                return { error: true, message: 'معرف الطبيب غير صالح' };
            }

            const doctor = await doctorService.getById(params.id);
            if (!doctor) {
                set.status = 404;
                return { error: true, message: 'الطبيب غير موجود' };
            }

            const payload: Record<string, unknown> = { verification_status: body.verification_status };
            if (body.license_verified !== undefined) payload.license_verified = body.license_verified;
            if (body.verification_status === IDoctorVerificationStatusEnum.VERIFIED)
                payload.license_verified = body.license_verified ?? true;

            const updated = await doctorService.update(params.id, payload, {
                user_id: phrase._id,
                user_name: phrase.role + '_' + phrase._id,
                user_type: phrase.role,
                endpoint: '/dash/admin/doctors/' + params.id + '/verification',
                source: 'dashboard',
            });
            return { error: false, message: 'تم تحديث حالة التحقق بنجاح', data: updated };
        },
        {
            params: t.Object({ id: t.String() }),
            body: t.Object({
                verification_status: t.Enum(IDoctorVerificationStatusEnum),
                license_verified: t.Optional(t.Boolean()),
            }),
            response: { 200: GenericDataResponseSchema, 400: BadRequestResponseSchema, 404: NotFoundResponseSchema, 422: ValidationErrorResponseSchema, ...ProtectedApiErrorResponses },
        }
    );
