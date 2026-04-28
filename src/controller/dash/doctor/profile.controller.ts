import Elysia, { t } from 'elysia';
import { AuthPlugin } from '../../../middleware/auth.middleware';
import doctorService from '../../../services/doctor.service';
import { IDoctorGenderEnum } from '../../../interfaces/doctor.interface';

const profileBodySchema = t.Object({
    displayName: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
    gender: t.Optional(t.Nullable(t.Enum(IDoctorGenderEnum))),
    profilePhoto: t.Optional(t.Nullable(t.String())),
    bio: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
    languages: t.Optional(t.Array(t.String())),
    subSpecialties: t.Optional(t.Array(t.String())),
    experienceYears: t.Optional(t.Nullable(t.Number({ minimum: 0 }))),
    clinicLocation: t.Optional(t.Nullable(t.String({ maxLength: 300 }))),
    mapLocation: t.Optional(
        t.Nullable(
            t.Object({
                lat: t.Optional(t.Nullable(t.Number())),
                lng: t.Optional(t.Nullable(t.Number())),
            })
        )
    ),
    appointmentDuration: t.Optional(t.Number({ minimum: 5 })),
    slotInterval: t.Optional(t.Number({ minimum: 5 })),
    bufferBefore: t.Optional(t.Number({ minimum: 0 })),
    bufferAfter: t.Optional(t.Number({ minimum: 0 })),
    acceptAutoBooking: t.Optional(t.Boolean()),
    allowReschedule: t.Optional(t.Boolean()),
    bookingLeadTimeHours: t.Optional(t.Number({ minimum: 0 })),
    cancellationWindowHours: t.Optional(t.Number({ minimum: 0 })),
    consultationFee: t.Optional(t.Nullable(t.Number({ minimum: 0 }))),
    followUpFee: t.Optional(t.Nullable(t.Number({ minimum: 0 }))),
    currency: t.Optional(t.Nullable(t.String({ maxLength: 10 }))),
    acceptingNewPatients: t.Optional(t.Boolean()),
});

export const doctorProfileController = new Elysia({ prefix: '/profile' })
    .use(AuthPlugin)

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
            if (body.displayName !== undefined) payload.display_name = body.displayName;
            if (body.gender !== undefined) payload.gender = body.gender;
            if (body.profilePhoto !== undefined) payload.profile_photo = body.profilePhoto;
            if (body.bio !== undefined) payload.bio = body.bio;
            if (body.languages !== undefined) payload.languages = body.languages;
            if (body.subSpecialties !== undefined) payload.sub_specialties = body.subSpecialties;
            if (body.experienceYears !== undefined) payload.experience_years = body.experienceYears;
            if (body.clinicLocation !== undefined) payload.clinic_location = body.clinicLocation;
            if (body.mapLocation !== undefined) payload.map_location = body.mapLocation;
            if (body.appointmentDuration !== undefined) payload.appointment_duration = body.appointmentDuration;
            if (body.slotInterval !== undefined) payload.slot_interval = body.slotInterval;
            if (body.bufferBefore !== undefined) payload.buffer_before = body.bufferBefore;
            if (body.bufferAfter !== undefined) payload.buffer_after = body.bufferAfter;
            if (body.acceptAutoBooking !== undefined) payload.accept_auto_booking = body.acceptAutoBooking;
            if (body.allowReschedule !== undefined) payload.allow_reschedule = body.allowReschedule;
            if (body.bookingLeadTimeHours !== undefined) payload.booking_lead_time_hours = body.bookingLeadTimeHours;
            if (body.cancellationWindowHours !== undefined) payload.cancellation_window_hours = body.cancellationWindowHours;
            if (body.consultationFee !== undefined) payload.consultation_fee = body.consultationFee;
            if (body.followUpFee !== undefined) payload.follow_up_fee = body.followUpFee;
            if (body.currency !== undefined) payload.currency = body.currency;
            if (body.acceptingNewPatients !== undefined) payload.accepting_new_patients = body.acceptingNewPatients;

            const updated = await doctorService.update((doctor._id as string).toString(), payload);
            return { error: false, message: 'تم تحديث الملف الشخصي بنجاح', data: updated };
        },
        { body: profileBodySchema }
    );
