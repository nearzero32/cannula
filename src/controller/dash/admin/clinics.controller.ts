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

            return {
                error: false,
                data,
                meta: { page, limit, total: count, pages: Math.ceil(count / limit) },
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
                return { error: true, message: 'Invalid clinic ID' };
            }

            const clinic = await clinicService.getById(params.id);
            if (!clinic) {
                set.status = 404;
                return { error: true, message: 'Clinic not found' };
            }

            return { error: false, data: clinic };
        },
        { params: t.Object({ id: t.String() }) }
    )

    .post(
        '/',
        async ({ body, phrase, set }) => {
            const clinic = await clinicService.create({
                ...body,
                status: body.status ?? IClinicStatusEnum.ACTIVE,
                workingDays: body.workingDays ?? [],
                createdBy: new ObjectId(phrase._id),
            });

            set.status = 201;
            return { error: false, data: clinic };
        },
        { body: clinicBodySchema }
    )

    .patch(
        '/:id',
        async ({ params, body, set }) => {
            if (!ObjectId.isValid(params.id)) {
                set.status = 400;
                return { error: true, message: 'Invalid clinic ID' };
            }

            const clinic = await clinicService.getById(params.id);
            if (!clinic) {
                set.status = 404;
                return { error: true, message: 'Clinic not found' };
            }

            const updated = await clinicService.update(params.id, body);
            return { error: false, data: updated };
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
                return { error: true, message: 'Invalid clinic ID' };
            }

            const clinic = await clinicService.getById(params.id);
            if (!clinic) {
                set.status = 404;
                return { error: true, message: 'Clinic not found' };
            }

            const updated = await clinicService.update(params.id, { status: body.status });
            return { error: false, data: updated };
        },
        {
            params: t.Object({ id: t.String() }),
            body: t.Object({ status: t.Enum(IClinicStatusEnum) }),
        }
    );
