import Elysia, { t } from 'elysia';
import mongoose from 'mongoose';
import { AuthPlugin } from '../../../middleware/auth.middleware';
import doctorService from '../../../services/doctor.service';
import {
    IDoctorGenderEnum,
    IDoctorStatusEnum,
    IDoctorVerificationStatusEnum,
} from '../../../interfaces/doctor.interface';

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
    clinic_location: t.Optional(t.Nullable(t.String({ maxLength: 300 }))),
    map_location: t.Optional(
        t.Nullable(
            t.Object({
                lat: t.Optional(t.Nullable(t.Number())),
                lng: t.Optional(t.Nullable(t.Number())),
            })
        )
    ),
    appointment_duration: t.Optional(t.Number({ minimum: 5 })),
    slot_interval: t.Optional(t.Number({ minimum: 5 })),
    buffer_before: t.Optional(t.Number({ minimum: 0 })),
    buffer_after: t.Optional(t.Number({ minimum: 0 })),
    accept_auto_booking: t.Optional(t.Boolean()),
    allow_reschedule: t.Optional(t.Boolean()),
    booking_lead_time_hours: t.Optional(t.Number({ minimum: 0 })),
    cancellation_window_hours: t.Optional(t.Number({ minimum: 0 })),
    consultation_fee: t.Optional(t.Nullable(t.Number({ minimum: 0 }))),
    follow_up_fee: t.Optional(t.Nullable(t.Number({ minimum: 0 }))),
    currency: t.Optional(t.Nullable(t.String({ maxLength: 10 }))),
    assistant_ids: t.Optional(t.Array(t.String())),
    accepting_new_patients: t.Optional(t.Boolean()),
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
        clinic_location: t.Nullable(t.String({ maxLength: 300 })),
        map_location: t.Nullable(
            t.Object({
                lat: t.Nullable(t.Number()),
                lng: t.Nullable(t.Number()),
            })
        ),
        appointment_duration: t.Number({ minimum: 5 }),
        slot_interval: t.Number({ minimum: 5 }),
        buffer_before: t.Number({ minimum: 0 }),
        buffer_after: t.Number({ minimum: 0 }),
        accept_auto_booking: t.Boolean(),
        allow_reschedule: t.Boolean(),
        booking_lead_time_hours: t.Number({ minimum: 0 }),
        cancellation_window_hours: t.Number({ minimum: 0 }),
        consultation_fee: t.Nullable(t.Number({ minimum: 0 })),
        follow_up_fee: t.Nullable(t.Number({ minimum: 0 })),
        currency: t.Nullable(t.String({ maxLength: 10 })),
        assistant_ids: t.Array(t.String()),
        accepting_new_patients: t.Boolean(),
        is_featured: t.Boolean(),
        notes_internal: t.Nullable(t.String({ maxLength: 2000 })),
    })
);

export const doctorsController = new Elysia({ prefix: '/doctors' })
    .use(AuthPlugin)

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
        { params: t.Object({ id: t.String() }) }
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
                    clinic_location: body.clinic_location,
                    map_location: body.map_location,
                    appointment_duration: body.appointment_duration ?? 30,
                    slot_interval: body.slot_interval ?? 15,
                    buffer_before: body.buffer_before ?? 0,
                    buffer_after: body.buffer_after ?? 0,
                    accept_auto_booking: body.accept_auto_booking ?? false,
                    allow_reschedule: body.allow_reschedule ?? true,
                    booking_lead_time_hours: body.booking_lead_time_hours ?? 1,
                    cancellation_window_hours: body.cancellation_window_hours ?? 24,
                    consultation_fee: body.consultation_fee,
                    follow_up_fee: body.follow_up_fee,
                    currency: body.currency ?? 'IQD',
                    assistant_ids: body.assistant_ids?.map((id) => new ObjectId(id)) ?? [],
                    accepting_new_patients: body.accepting_new_patients ?? true,
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
        { body: doctorBodySchema }
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
            if (body.clinic_location !== undefined) payload.clinic_location = body.clinic_location;
            if (body.map_location !== undefined) payload.map_location = body.map_location;
            if (body.appointment_duration !== undefined) payload.appointment_duration = body.appointment_duration;
            if (body.slot_interval !== undefined) payload.slot_interval = body.slot_interval;
            if (body.buffer_before !== undefined) payload.buffer_before = body.buffer_before;
            if (body.buffer_after !== undefined) payload.buffer_after = body.buffer_after;
            if (body.accept_auto_booking !== undefined) payload.accept_auto_booking = body.accept_auto_booking;
            if (body.allow_reschedule !== undefined) payload.allow_reschedule = body.allow_reschedule;
            if (body.booking_lead_time_hours !== undefined) payload.booking_lead_time_hours = body.booking_lead_time_hours;
            if (body.cancellation_window_hours !== undefined) payload.cancellation_window_hours = body.cancellation_window_hours;
            if (body.consultation_fee !== undefined) payload.consultation_fee = body.consultation_fee;
            if (body.follow_up_fee !== undefined) payload.follow_up_fee = body.follow_up_fee;
            if (body.currency !== undefined) payload.currency = body.currency;
            if (body.assistant_ids !== undefined) payload.assistant_ids = body.assistant_ids.map((id) => new ObjectId(id));
            if (body.accepting_new_patients !== undefined) payload.accepting_new_patients = body.accepting_new_patients;
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
        }
    );
