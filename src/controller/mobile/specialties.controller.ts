import Elysia, { t } from 'elysia';
import mongoose from 'mongoose';
import specialtyService from '../../services/specialty.service';
import { ISpecialtyStatusEnum, type ISpecialty } from '../../interfaces/specialty.interface';

const ObjectId = mongoose.Types.ObjectId;

function formatSpecialtyForMobile(specialty: ISpecialty & { _id: mongoose.Types.ObjectId }) {
    return {
        _id: specialty._id,
        name: specialty.name,
        description: specialty.description,
        icon: specialty.icon,
        sort_order: specialty.sort_order,
    };
}

export const mobileSpecialtiesController = new Elysia({ prefix: '/specialties' })

    .get(
        '/',
        async ({ query }) => {
            const page = Math.max(1, Number(query.page) || 1);
            const limit = Math.min(100, Math.max(1, Number(query.limit) || 10));

            const main_match: Record<string, unknown> = {
                status: ISpecialtyStatusEnum.ACTIVE,
            };

            if (query.search) {
                main_match.$or = [
                    { name: { $regex: query.search, $options: 'i' } },
                    { description: { $regex: query.search, $options: 'i' } },
                ];
            }

            const { data, count } = await specialtyService.getPaginated({ main_match, page, limit });
            const totalPages = Math.ceil(count / limit);

            return {
                error: false,
                message: 'تم جلب التخصصات بنجاح',
                data: data.map((specialty) => formatSpecialtyForMobile(specialty)),
                pagination: { page, limit, total: count, pages: totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
            };
        },
        {
            query: t.Object({
                page: t.Optional(t.String()),
                limit: t.Optional(t.String()),
                search: t.Optional(t.String()),
            }),
        }
    )

    .get(
        '/:id',
        async ({ params, set }) => {
            if (!ObjectId.isValid(params.id)) {
                set.status = 400;
                return { error: true, message: 'معرف التخصص غير صالح' };
            }

            const specialty = await specialtyService.getById(params.id);
            if (!specialty || specialty.status !== ISpecialtyStatusEnum.ACTIVE) {
                set.status = 404;
                return { error: true, message: 'التخصص غير موجود' };
            }

            return {
                error: false,
                message: 'تم جلب التخصص بنجاح',
                data: formatSpecialtyForMobile(specialty),
            };
        },
        { params: t.Object({ id: t.String() }) }
    );
