import Elysia, { t } from 'elysia';
import mongoose from 'mongoose';
import { AuthPlugin } from '../../middleware/auth.middleware';
import doctorFavoriteService from '../../services/doctor-favorite.service';
import patientService from '../../services/patient.service';
import doctorService from '../../services/doctor.service';
import { IUserRoleEnum } from '../../interfaces/user.interface';
import { IDoctorStatusEnum } from '../../interfaces/doctor.interface';
import { IActivityLogSourceEnum } from '../../interfaces/activity-log.interface';

const ObjectId = mongoose.Types.ObjectId;

const createFavoriteBodySchema = t.Object({
    doctor_id: t.String(),
});

const doctorLookupPipeline = [
    {
        $lookup: {
            from: 'doctors',
            localField: 'doctor_id',
            foreignField: '_id',
            as: 'doctor',
        },
    },
    { $unwind: { path: '$doctor', preserveNullAndEmptyArrays: true } },
    {
        $project: {
            _id: 1,
            doctor_id: 1,
            createdAt: 1,
            doctor: {
                _id: '$doctor._id',
                display_name: '$doctor.display_name',
                profile_photo: '$doctor.profile_photo',
                specialty: '$doctor.specialty',
                experience_years: '$doctor.experience_years',
                consultation_fee: '$doctor.consultation_fee',
                currency: '$doctor.currency',
                is_featured: '$doctor.is_featured',
                status: '$doctor.status',
            },
        },
    },
];

function activityMeta(phrase: { _id: string; role: string }, endpoint: string) {
    return {
        user_id: phrase._id,
        user_name: phrase.role + '_' + phrase._id,
        user_type: phrase.role,
        endpoint,
        source: IActivityLogSourceEnum.MOBILE,
    };
}

export const mobileDoctorFavoritesController = new Elysia({ prefix: '/doctor-favorites' })
    .use(AuthPlugin())

    .get(
        '/',
        async ({ phrase, query, set }) => {
            if (phrase.role !== IUserRoleEnum.PATIENT) {
                set.status = 403;
                return { error: true, message: 'غير مصرح لك بالوصول' };
            }

            const patient = await patientService.getByUserId(phrase._id);
            if (!patient) {
                set.status = 404;
                return { error: true, message: 'الملف الشخصي غير موجود' };
            }

            const page = Math.max(1, Number(query.page) || 1);
            const limit = Math.min(100, Math.max(1, Number(query.limit) || 10));

            const { data, count } = await doctorFavoriteService.getPaginated({
                main_match: { patient_id: patient._id },
                additional_pipeline: doctorLookupPipeline,
                page,
                limit,
            });
            const totalPages = Math.ceil(count / limit);

            return {
                error: false,
                message: 'تم جلب الأطباء المفضلين بنجاح',
                data,
                pagination: { page, limit, total: count, pages: totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
            };
        },
        {
            query: t.Object({
                page: t.Optional(t.String()),
                limit: t.Optional(t.String()),
            }),
        }
    )

    .post(
        '/',
        async ({ body, phrase, set }) => {
            if (phrase.role !== IUserRoleEnum.PATIENT) {
                set.status = 403;
                return { error: true, message: 'غير مصرح لك بالوصول' };
            }

            if (!ObjectId.isValid(body.doctor_id)) {
                set.status = 400;
                return { error: true, message: 'معرف الطبيب غير صالح' };
            }

            const patient = await patientService.getByUserId(phrase._id);
            if (!patient) {
                set.status = 404;
                return { error: true, message: 'الملف الشخصي غير موجود' };
            }

            const doctor = await doctorService.getById(body.doctor_id);
            if (!doctor || doctor.status !== IDoctorStatusEnum.ACTIVE) {
                set.status = 404;
                return { error: true, message: 'الطبيب غير موجود' };
            }

            const existing = await doctorFavoriteService.findByPatientAndDoctor(
                (patient._id as mongoose.Types.ObjectId).toString(),
                body.doctor_id
            );
            if (existing) {
                set.status = 409;
                return { error: true, message: 'الطبيب موجود بالفعل في المفضلة' };
            }

            const item = await doctorFavoriteService.create(
                {
                    patient_id: patient._id as mongoose.Types.ObjectId,
                    doctor_id: new ObjectId(body.doctor_id),
                },
                activityMeta(phrase, '/mobile/doctor-favorites')
            );

            set.status = 201;
            return { error: false, message: 'تمت إضافة الطبيب إلى المفضلة بنجاح', data: item };
        },
        { body: createFavoriteBodySchema }
    )

    .delete(
        '/:doctor_id',
        async ({ params, phrase, set }) => {
            if (phrase.role !== IUserRoleEnum.PATIENT) {
                set.status = 403;
                return { error: true, message: 'غير مصرح لك بالوصول' };
            }

            if (!ObjectId.isValid(params.doctor_id)) {
                set.status = 400;
                return { error: true, message: 'معرف الطبيب غير صالح' };
            }

            const patient = await patientService.getByUserId(phrase._id);
            if (!patient) {
                set.status = 404;
                return { error: true, message: 'الملف الشخصي غير موجود' };
            }

            const removed = await doctorFavoriteService.removeByPatientAndDoctor(
                (patient._id as mongoose.Types.ObjectId).toString(),
                params.doctor_id,
                activityMeta(phrase, `/mobile/doctor-favorites/${params.doctor_id}`)
            );

            if (!removed) {
                set.status = 404;
                return { error: true, message: 'الطبيب غير موجود في المفضلة' };
            }

            return { error: false, message: 'تمت إزالة الطبيب من المفضلة بنجاح', data: removed };
        },
        { params: t.Object({ doctor_id: t.String() }) }
    );
