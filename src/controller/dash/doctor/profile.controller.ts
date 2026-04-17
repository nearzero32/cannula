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

            const updated = await doctorService.update((doctor._id as string).toString(), body);
            return { error: false, message: 'تم تحديث الملف الشخصي بنجاح', data: updated };
        },
        { body: profileBodySchema }
    );
