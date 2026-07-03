import Elysia, { t } from 'elysia';
import mongoose from 'mongoose';
import { AuthPlugin } from '../../middleware/auth.middleware';
import patientService from '../../services/patient.service';
import userService from '../../services/user.service';
import {
    IPatientBloodGroupEnum,
    IPatientGenderEnum,
    type IPatient,
} from '../../interfaces/patient.interface';
import { IUserRoleEnum } from '../../interfaces/user.interface';
import { IActivityLogSourceEnum } from '../../interfaces/activity-log.interface';

const ObjectId = mongoose.Types.ObjectId;

const completeProfileBodySchema = t.Object({
    full_name: t.Optional(t.String({ minLength: 2, maxLength: 120 })),
    email: t.Optional(t.Nullable(t.String())),
    gender: t.Optional(t.Nullable(t.Enum(IPatientGenderEnum))),
    date_of_birth: t.Optional(t.Nullable(t.String())),
    address: t.Optional(t.Nullable(t.String({ maxLength: 300 }))),
    profile_photo: t.Optional(t.Nullable(t.String())),
    blood_group: t.Optional(t.Nullable(t.Enum(IPatientBloodGroupEnum))),
    allergies: t.Optional(t.Array(t.String())),
    chronic_condition_ids: t.Optional(t.Array(t.String())),
});

function isProfileComplete(patient: IPatient): boolean {
    return Boolean(patient.gender && patient.date_of_birth);
}

function formatPatientResponse(patient: IPatient & { _id: mongoose.Types.ObjectId }) {
    return {
        _id: patient._id.toString(),
        user_id: patient.user_id.toString(),
        full_name: patient.full_name,
        phone: patient.phone,
        gender: patient.gender,
        date_of_birth: patient.date_of_birth,
        address: patient.address,
        profile_photo: patient.profile_photo,
        blood_group: patient.blood_group,
        allergies: patient.allergies,
        chronic_condition_ids: patient.chronic_condition_ids,
        status: patient.status,
        profile_completed: isProfileComplete(patient),
    };
}

export const mobileProfileController = new Elysia({ prefix: '/profile' })
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
            data: formatPatientResponse(patient),
        };
    })

    .patch(
        '/complete-profile',
        async ({ body, phrase, set }) => {
            if (phrase.role !== IUserRoleEnum.PATIENT) {
                set.status = 403;
                return { error: true, message: 'غير مصرح لك بالوصول' };
            }

            if (body.chronic_condition_ids?.some((id) => !ObjectId.isValid(id))) {
                set.status = 400;
                return { error: true, message: 'معرف مرض مزمن غير صالح' };
            }

            const patient = await patientService.getByUserId(phrase._id);
            if (!patient) {
                set.status = 404;
                return { error: true, message: 'الملف الشخصي غير موجود' };
            }

            const patientPayload: Record<string, unknown> = {};
            if (body.full_name !== undefined) patientPayload.full_name = body.full_name;
            if (body.gender !== undefined) patientPayload.gender = body.gender;
            if (body.date_of_birth !== undefined) {
                patientPayload.date_of_birth = body.date_of_birth ? new Date(body.date_of_birth) : null;
            }
            if (body.address !== undefined) patientPayload.address = body.address;
            if (body.profile_photo !== undefined) patientPayload.profile_photo = body.profile_photo;
            if (body.blood_group !== undefined) patientPayload.blood_group = body.blood_group;
            if (body.allergies !== undefined) patientPayload.allergies = body.allergies;
            if (body.chronic_condition_ids !== undefined) patientPayload.chronic_condition_ids = body.chronic_condition_ids;

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
                (patient._id as mongoose.Types.ObjectId).toString(),
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
                data: formatPatientResponse(updated),
            };
        },
        { body: completeProfileBodySchema }
    );
