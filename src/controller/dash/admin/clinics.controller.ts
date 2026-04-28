import Elysia, { t } from 'elysia';
import mongoose from 'mongoose';
import { AuthPlugin } from '../../../middleware/auth.middleware';
import clinicService from '../../../services/clinic.service';
import { IClinicStatusEnum } from '../../../interfaces/clinic.interface';

const ObjectId = mongoose.Types.ObjectId;

const clinicBodySchema = t.Object({
    name: t.String({ minLength: 1, maxLength: 150 }),
    address: t.String({ minLength: 1, maxLength: 300 }),
    description: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
    icon: t.Optional(t.Nullable(t.String())),
    mapLocation: t.Optional(
        t.Nullable(
            t.Object({
                lat: t.Optional(t.Nullable(t.Number())),
                lng: t.Optional(t.Nullable(t.Number())),
            })
        )
    ),
    workingDays: t.Optional(
        t.Array(
            t.Object({
                day: t.Integer({ minimum: 0, maximum: 6 }),
                enabled: t.Boolean(),
                from: t.Optional(t.Nullable(t.String())),
                to: t.Optional(t.Nullable(t.String())),
            })
        )
    ),
    status: t.Optional(t.Enum(IClinicStatusEnum)),
    notesInternal: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
});

export const clinicsController = new Elysia({ prefix: '/clinics' })
    .use(AuthPlugin)

    .get(
        '/',
        async ({ query }) => {
            const page = Math.max(1, Number(query.page) || 1);
            const limit = Math.min(100, Math.max(1, Number(query.limit) || 10));

            const main_match: Record<string, unknown> = {};

            if (query.status) main_match.status = query.status;
            if (query.search) {
                main_match.$or = [
                    { name: { $regex: query.search, $options: 'i' } },
                    { address: { $regex: query.search, $options: 'i' } },
                ];
            }

            const { data, count } = await clinicService.getPaginated({ main_match, page, limit });
            const totalPages = Math.ceil(count / limit);

            return {
                error: false,
                message: 'تم جلب العيادات بنجاح',
                data,
                pagination: { page, limit, total: count, pages: totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
            };
        },
        {
            query: t.Object({
                page: t.Optional(t.String()),
                limit: t.Optional(t.String()),
                status: t.Optional(t.Enum(IClinicStatusEnum)),
                search: t.Optional(t.String()),
            }),
        }
    )

    .get(
        '/:id',
        async ({ params, set }) => {
            if (!ObjectId.isValid(params.id)) {
                set.status = 400;
                return { error: true, message: 'معرف العيادة غير صالح' };
            }

            const clinic = await clinicService.getById(params.id);
            if (!clinic) {
                set.status = 404;
                return { error: true, message: 'العيادة غير موجودة' };
            }

            return { error: false, message: 'تم جلب العيادة بنجاح', data: clinic };
        },
        { params: t.Object({ id: t.String() }) }
    )

    .post(
        '/',
        async ({ body, phrase, set }) => {
            const clinic = await clinicService.create({
                name: body.name,
                address: body.address,
                description: body.description,
                icon: body.icon,
                map_location: body.mapLocation,
                working_days: body.workingDays ?? [],
                status: body.status ?? IClinicStatusEnum.ACTIVE,
                notes_internal: body.notesInternal,
                created_by: new ObjectId(phrase._id),
            });

            set.status = 201;
            return { error: false, message: 'تم إنشاء العيادة بنجاح', data: clinic };
        },
        { body: clinicBodySchema }
    )

    .patch(
        '/:id',
        async ({ params, body, set }) => {
            if (!ObjectId.isValid(params.id)) {
                set.status = 400;
                return { error: true, message: 'معرف العيادة غير صالح' };
            }

            const clinic = await clinicService.getById(params.id);
            if (!clinic) {
                set.status = 404;
                return { error: true, message: 'العيادة غير موجودة' };
            }

            const payload: Record<string, unknown> = {};
            if (body.name !== undefined) payload.name = body.name;
            if (body.address !== undefined) payload.address = body.address;
            if (body.description !== undefined) payload.description = body.description;
            if (body.icon !== undefined) payload.icon = body.icon;
            if (body.mapLocation !== undefined) payload.map_location = body.mapLocation;
            if (body.workingDays !== undefined) payload.working_days = body.workingDays;
            if (body.status !== undefined) payload.status = body.status;
            if (body.notesInternal !== undefined) payload.notes_internal = body.notesInternal;

            const updated = await clinicService.update(params.id, payload);
            return { error: false, message: 'تم تحديث العيادة بنجاح', data: updated };
        },
        {
            params: t.Object({ id: t.String() }),
            body: t.Partial(clinicBodySchema),
        }
    )

    .patch(
        '/:id/status',
        async ({ params, body, set }) => {
            if (!ObjectId.isValid(params.id)) {
                set.status = 400;
                return { error: true, message: 'معرف العيادة غير صالح' };
            }

            const clinic = await clinicService.getById(params.id);
            if (!clinic) {
                set.status = 404;
                return { error: true, message: 'العيادة غير موجودة' };
            }

            const updated = await clinicService.update(params.id, { status: body.status });
            return { error: false, message: 'تم تحديث حالة العيادة بنجاح', data: updated };
        },
        {
            params: t.Object({ id: t.String() }),
            body: t.Object({ status: t.Enum(IClinicStatusEnum) }),
        }
    );
