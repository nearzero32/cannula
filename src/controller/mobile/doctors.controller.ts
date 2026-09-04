import Elysia, { t } from 'elysia';
import { SWAGGER_TAGS } from '../../constants/swagger-tags';
import mongoose from 'mongoose';
import doctorService, { PATIENT_DOCTOR_SORT, PUBLIC_DOCTOR_MATCH } from '../../services/doctor.service';
import {
    IDoctorGenderEnum,
    type IDoctor,
} from '../../interfaces/doctor.interface';
import { BadRequestResponseSchema, GenericPaginatedResponseSchema, NotFoundResponseSchema, PublicApiErrorResponses, ValidationErrorResponseSchema } from '../../schemas/api-response.schema';
import { doctorSpecialtyMap } from '../../services/doctor-specialty.service';
import Specialty from '../../models/specialties.model';
import { safeSearchPattern } from '../../services/search-safety.service';
import availableDoctorsService, { AVAILABLE_DOCTORS_CACHE_TTL_SECONDS, availableDoctorsCacheKey } from '../../services/available-doctors.service';
import RedisClient from '../../databases/redis';
import { DomainError } from '../../services/domain-error';
import { toBaghdadLocal } from '../../services/appointment-time.service';
import Clinic from '../../models/clinics.model';
import { IClinicStatusEnum } from '../../interfaces/clinic.interface';
import { ISpecialtyStatusEnum } from '../../interfaces/specialty.interface';

const ObjectId = mongoose.Types.ObjectId;

const availableDoctorsResponseSchema = t.Object({
    error: t.Literal(false),
    message: t.String(),
    data: t.Array(t.Object({
        _id: t.String(),
        display_name: t.String(),
        availability: t.Object({
            date: t.String({ format: 'date' }),
            timezone: t.Literal('Asia/Baghdad'),
            clinicId: t.String(),
            nextSlot: t.Object({ startsAt: t.String(), endsAt: t.String(), localStartsAt: t.String(), localEndsAt: t.String() }),
            availableSlotCount: t.Integer({ minimum: 1 }),
        }),
    }, { additionalProperties: true })),
    pagination: t.Object({ page: t.Integer(), limit: t.Integer(), total: t.Integer(), pages: t.Integer(), hasNext: t.Boolean(), hasPrev: t.Boolean() }),
});

const doctorDetailResponseSchema = t.Object({
    error: t.Literal(false),
    message: t.String(),
    data: t.Object({
        _id: t.String(),
        display_name: t.String(),
        clinics: t.Array(t.Object({
            _id: t.String(), name: t.String(), address: t.String(), icon: t.Nullable(t.String()),
            map_location: t.Object({ lat: t.Nullable(t.Number()), lng: t.Nullable(t.Number()) }),
        })),
    }, { additionalProperties: true }),
});

export function formatDoctorForMobile(doctor: IDoctor & { _id: unknown }, specialties: Map<string, { _id: string; name: string; icon: string | null }>, detailed = false) {
    const base = {
        _id: String(doctor._id),
        display_name: doctor.display_name,
        profile_photo: doctor.profile_photo,
        gender: doctor.gender,
        primary_specialty: specialties.get(String(doctor.primary_specialty_id)) ?? null,
        specialties: (doctor.specialty_ids ?? []).map(id => specialties.get(String(id))).filter(Boolean),
        experience_years: doctor.experience_years,
        consultation_fee: doctor.consultation_fee,
        follow_up_fee: doctor.follow_up_fee,
        currency: doctor.currency,
        is_featured: doctor.is_featured,
        accepting_new_patients: doctor.accepting_new_patients,
        is_verified: true,
    };

    if (!detailed) return base;

    return {
        ...base,
        bio: doctor.bio,
        languages: doctor.languages,
        map_location: doctor.map_location,
        appointment_duration: doctor.appointment_duration,
    };
}

export const mobileDoctorsController = new Elysia({
    prefix: '/doctors',
    detail: { tags: [SWAGGER_TAGS.MOBILE.DOCTORS] },
})

    .get(
        '/',
        async ({ query }) => {
            const page = Math.max(1, Number(query.page) || 1);
            const limit = Math.min(100, Math.max(1, Number(query.limit) || 10));

            const main_match: Record<string, unknown> = { ...PUBLIC_DOCTOR_MATCH };

            if (query.specialty_id) {
                if (!ObjectId.isValid(query.specialty_id)) throw new DomainError('معرف التخصص غير صالح', 400, 'SPECIALTY_INVALID');
                main_match.specialty_ids = new ObjectId(query.specialty_id);
            }

            if (query.gender) main_match.gender = query.gender;

            if (query.is_featured && query.is_featured !== 'true' && query.is_featured !== 'false') throw new DomainError('قيمة المميز غير صالحة', 400, 'INVALID_FEATURED_FILTER');
            if (query.is_featured === 'true') main_match.is_featured = true;

            if (query.clinic_id) {
                if (!ObjectId.isValid(query.clinic_id)) throw new DomainError('معرف العيادة غير صالح', 400, 'CLINIC_INVALID');
                main_match.clinic_ids = new ObjectId(query.clinic_id);
            }

            if (query.search) {
                const search = safeSearchPattern(query.search);
                const matchingSpecialties = await Specialty.find({ name: { $regex: search, $options: 'i' }, status: ISpecialtyStatusEnum.ACTIVE }).select('_id').lean().exec();
                main_match.$or = [
                    { display_name: { $regex: search, $options: 'i' } },
                    ...(matchingSpecialties.length ? [{ specialty_ids: { $in: matchingSpecialties.map(item => item._id) } }] : []),
                ];
            }

            const { data, count } = await doctorService.getPaginated({ main_match, sort: PATIENT_DOCTOR_SORT, page, limit });
            const totalPages = Math.ceil(count / limit);

            const specialties = await doctorSpecialtyMap(data, { publicOnly: true });
            return {
                error: false,
                message: 'تم جلب الأطباء بنجاح',
                data: data.map((doctor) => formatDoctorForMobile(doctor, specialties)),
                pagination: { page, limit, total: count, pages: totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
            };
        },
        {
            query: t.Object({
                page: t.Optional(t.String()),
                limit: t.Optional(t.String()),
                specialty_id: t.Optional(t.String()),
                clinic_id: t.Optional(t.String()),
                gender: t.Optional(t.Enum(IDoctorGenderEnum)),
                is_featured: t.Optional(t.String()),
                search: t.Optional(t.String()),
            }),
            response: { 200: GenericPaginatedResponseSchema, 400: BadRequestResponseSchema, 422: ValidationErrorResponseSchema, ...PublicApiErrorResponses },
        }
    )

    .get(
        '/available',
        async ({ query }) => {
            const page = Math.max(1, Number(query.page) || 1);
            const limit = Math.min(50, Math.max(1, Number(query.limit) || 10));
            for (const [name, value] of [['specialty_id', query.specialty_id], ['clinic_id', query.clinic_id]] as const) {
                if (value && !ObjectId.isValid(value)) throw new DomainError(`معرف ${name === 'specialty_id' ? 'التخصص' : 'العيادة'} غير صالح`, 400, 'INVALID_OBJECT_ID');
            }
            if (query.is_featured && query.is_featured !== 'true' && query.is_featured !== 'false') {
                throw new DomainError('قيمة المميز غير صالحة', 400, 'INVALID_FEATURED_FILTER');
            }

            const now = new Date();
            const date = toBaghdadLocal(now).date;
            const filters = {
                specialty_id: query.specialty_id,
                clinic_id: query.clinic_id,
                gender: query.gender,
                is_featured: query.is_featured === 'true',
            };
            const key = availableDoctorsCacheKey({ ...filters, date, page, limit });
            let cached: unknown = null;
            try {
                const raw = await RedisClient.getInstance().get(key);
                if (raw) cached = JSON.parse(raw);
            } catch {
                console.warn(JSON.stringify({ level: 'warn', event: 'available_doctors_cache_get_failed' }));
            }
            if (cached && typeof cached === 'object') return cached as any;

            const available = await availableDoctorsService.discover(filters, now);
            const specialties = await doctorSpecialtyMap(available.map(item => item.doctor), { publicOnly: true });
            const total = available.length;
            const pages = Math.ceil(total / limit);
            const data = available.slice((page - 1) * limit, page * limit).map(item => ({
                ...formatDoctorForMobile(item.doctor, specialties),
                availability: item.availability,
            }));
            const response = {
                error: false,
                message: 'تم جلب الأطباء المتاحين بنجاح',
                data,
                pagination: { page, limit, total, pages, hasNext: page < pages, hasPrev: page > 1 },
            };
            try {
                await RedisClient.getInstance().set(key, JSON.stringify(response), AVAILABLE_DOCTORS_CACHE_TTL_SECONDS);
            } catch {
                console.warn(JSON.stringify({ level: 'warn', event: 'available_doctors_cache_set_failed' }));
            }
            return response;
        },
        {
            query: t.Object({
                page: t.Optional(t.String()),
                limit: t.Optional(t.String()),
                specialty_id: t.Optional(t.String()),
                clinic_id: t.Optional(t.String()),
                gender: t.Optional(t.Enum(IDoctorGenderEnum)),
                is_featured: t.Optional(t.String()),
            }),
            response: { 200: availableDoctorsResponseSchema, 400: BadRequestResponseSchema, 422: ValidationErrorResponseSchema, ...PublicApiErrorResponses },
        }
    )

    .get(
        '/:id',
        async ({ params, set }) => {
            if (!ObjectId.isValid(params.id)) {
                set.status = 400;
                return { error: true, message: 'معرف الطبيب غير صالح' };
            }

            const doctor = await doctorService.getOneBy({ main_match: { $match: { _id: new ObjectId(params.id), ...PUBLIC_DOCTOR_MATCH } } });
            if (!doctor) {
                set.status = 404;
                return { error: true, message: 'الطبيب غير موجود' };
            }

            const [specialties, clinics] = await Promise.all([
                doctorSpecialtyMap([doctor], { publicOnly: true }),
                Clinic.find({ _id: { $in: doctor.clinic_ids ?? [] }, status: IClinicStatusEnum.ACTIVE })
                    .select('_id name address icon map_location').lean().exec(),
            ]);
            const clinicsById = new Map(clinics.map(clinic => [String(clinic._id), {
                _id: String(clinic._id), name: clinic.name, address: clinic.address, icon: clinic.icon ?? null,
                map_location: clinic.map_location ?? { lat: null, lng: null },
            }]));
            return {
                error: false,
                message: 'تم جلب الطبيب بنجاح',
                data: {
                    ...formatDoctorForMobile(doctor, specialties, true),
                    clinics: (doctor.clinic_ids ?? []).map(id => clinicsById.get(String(id))).filter(Boolean),
                },
            };
        },
        {
            params: t.Object({ id: t.String() }),
            response: { 200: doctorDetailResponseSchema, 400: BadRequestResponseSchema, 404: NotFoundResponseSchema, ...PublicApiErrorResponses },
        }
    );
