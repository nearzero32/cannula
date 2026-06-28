import Elysia, { t } from 'elysia';
import { AuthPlugin } from '../../../middleware/auth.middleware';
import doctorService from '../../../services/doctor.service';
import { IDoctorGenderEnum } from '../../../interfaces/doctor.interface';

const profileBodySchema = t.Object({
    display_name: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
    gender: t.Optional(t.Nullable(t.Enum(IDoctorGenderEnum))),
    profile_photo: t.Optional(t.Nullable(t.String())),
    bio: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
    languages: t.Optional(t.Array(t.String())),
    sub_specialties: t.Optional(t.Array(t.String())),
    experience_years: t.Optional(t.Nullable(t.Number({ minimum: 0 }))),
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
    accepting_new_patients: t.Optional(t.Boolean()),
});

export const doctorProfileController = new Elysia({ prefix: '/profile' })
    .use(AuthPlugin())

    .get('/', async ({ phrase, set }) => {
        const doctor = await doctorService.getByUserId(phrase._id);

        if (!doctor) {
            set.status = 404;
            return { error: true, message: 'الملف الشخصي غير موجود' };
        }

        return { error: false, message: 'تم جلب الملف الشخصي بنجاح', data: doctor };
    })

    .patch(
        '/',
        async ({ body, phrase, set }) => {
            const doctor = await doctorService.getByUserId(phrase._id);

            if (!doctor) {
                set.status = 404;
                return { error: true, message: 'الملف الشخصي غير موجود' };
            }

            const payload: Record<string, unknown> = {};
            if (body.display_name !== undefined) payload.display_name = body.display_name;
            if (body.gender !== undefined) payload.gender = body.gender;
            if (body.profile_photo !== undefined) payload.profile_photo = body.profile_photo;
            if (body.bio !== undefined) payload.bio = body.bio;
            if (body.languages !== undefined) payload.languages = body.languages;
            if (body.sub_specialties !== undefined) payload.sub_specialties = body.sub_specialties;
            if (body.experience_years !== undefined) payload.experience_years = body.experience_years;
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
            if (body.accepting_new_patients !== undefined) payload.accepting_new_patients = body.accepting_new_patients;

            const updated = await doctorService.update((doctor._id as string).toString(), payload, {
                user_id: phrase._id,
                user_name: phrase.role + '_' + phrase._id,
                user_type: phrase.role,
                endpoint: '/dash/doctor/profile',
                source: 'dashboard',
            });
            return { error: false, message: 'تم تحديث الملف الشخصي بنجاح', data: updated };
        },
        { body: profileBodySchema }
    );
