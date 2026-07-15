import Elysia, { t } from 'elysia';
import mongoose from 'mongoose';
import doctorService from '../../services/doctor.service';
import {
    IDoctorGenderEnum,
    IDoctorStatusEnum,
    type IDoctor,
} from '../../interfaces/doctor.interface';

const ObjectId = mongoose.Types.ObjectId;

function formatDoctorForMobile(doctor: IDoctor & { _id: mongoose.Types.ObjectId }, detailed = false) {
    const base = {
        _id: doctor._id,
        display_name: doctor.display_name,
        profile_photo: doctor.profile_photo,
        gender: doctor.gender,
        specialty: doctor.specialty,
        sub_specialties: doctor.sub_specialties,
        experience_years: doctor.experience_years,
        consultation_fee: doctor.consultation_fee,
        follow_up_fee: doctor.follow_up_fee,
        currency: doctor.currency,
        is_featured: doctor.is_featured,
        accepting_new_patients: doctor.accepting_new_patients,
        license_verified: doctor.license_verified,
        verification_status: doctor.verification_status,
    };

    if (!detailed) return base;

    return {
        ...base,
        bio: doctor.bio,
        languages: doctor.languages,
        clinic_ids: doctor.clinic_ids,
        map_location: doctor.map_location,
        appointment_duration: doctor.appointment_duration,
        slot_interval: doctor.slot_interval,
        accept_auto_booking: doctor.accept_auto_booking,
        allow_reschedule: doctor.allow_reschedule,
        booking_lead_time_hours: doctor.booking_lead_time_hours,
        cancellation_window_hours: doctor.cancellation_window_hours,
    };
}

export const mobileDoctorsController = new Elysia({ prefix: '/doctors' })

    .get(
        '/',
        async ({ query }) => {
            const page = Math.max(1, Number(query.page) || 1);
            const limit = Math.min(100, Math.max(1, Number(query.limit) || 10));

            const main_match: Record<string, unknown> = {
                status: IDoctorStatusEnum.ACTIVE,
            };

            if (query.specialty) main_match.specialty = query.specialty;

            if (query.gender) main_match.gender = query.gender;

            if (query.is_featured === 'true') main_match.is_featured = true;

            if (query.clinic_id && ObjectId.isValid(query.clinic_id)) {
                main_match.clinic_ids = new ObjectId(query.clinic_id);
            }

            if (query.search) {
                main_match.$or = [
                    { display_name: { $regex: query.search, $options: 'i' } },
                    { specialty: { $regex: query.search, $options: 'i' } },
                    { sub_specialties: { $regex: query.search, $options: 'i' } },
                ];
            }

            const { data, count } = await doctorService.getPaginated({ main_match, page, limit });
            const totalPages = Math.ceil(count / limit);

            return {
                error: false,
                message: 'تم جلب الأطباء بنجاح',
                data: data.map((doctor) => formatDoctorForMobile(doctor)),
                pagination: { page, limit, total: count, pages: totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
            };
        },
        {
            query: t.Object({
                page: t.Optional(t.String()),
                limit: t.Optional(t.String()),
                specialty: t.Optional(t.String()),
                clinic_id: t.Optional(t.String()),
                gender: t.Optional(t.Enum(IDoctorGenderEnum)),
                is_featured: t.Optional(t.String()),
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
            if (!doctor || doctor.status !== IDoctorStatusEnum.ACTIVE) {
                set.status = 404;
                return { error: true, message: 'الطبيب غير موجود' };
            }

            return {
                error: false,
                message: 'تم جلب الطبيب بنجاح',
                data: formatDoctorForMobile(doctor, true),
            };
        },
        { params: t.Object({ id: t.String() }) }
    );
