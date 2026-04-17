import Elysia, { t } from 'elysia';
import mongoose from 'mongoose';
import { AuthPlugin } from '../../../middleware/auth.middleware';
import adsService from '../../../services/ads.service';
import { IAdsStatusEnum } from '../../../interfaces/ads.interface';

const ObjectId = mongoose.Types.ObjectId;

const adsBodySchema = t.Object({
    title: t.Optional(t.Nullable(t.String({ maxLength: 200 }))),
    description: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
    image: t.String({ minLength: 1 }),
    link: t.Optional(t.Nullable(t.String())),
    clinicId: t.String({ minLength: 1 }),
    endDate: t.Optional(t.Nullable(t.String())),
});

export const adsController = new Elysia({ prefix: '/ads' })
    .use(AuthPlugin)

    .get(
        '/',
        async ({ query }) => {
            const page = Math.max(1, Number(query.page) || 1);
            const limit = Math.min(100, Math.max(1, Number(query.limit) || 10));

            const main_match: Record<string, unknown> = {};

            if (query.clinicId && ObjectId.isValid(query.clinicId)) {
                main_match.clinicId = new ObjectId(query.clinicId);
            }

            if (query.status) main_match.status = query.status;

            if (query.search) {
                main_match.$or = [
                    { title: { $regex: query.search, $options: 'i' } },
                    { description: { $regex: query.search, $options: 'i' } },
                ];
            }

            const { data, count } = await adsService.getPaginated({ main_match, page, limit });

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
                clinicId: t.Optional(t.String()),
                status: t.Optional(t.Enum(IAdsStatusEnum)),
                search: t.Optional(t.String()),
            }),
        }
    )

    .get(
        '/:id',
        async ({ params, set }) => {
            if (!ObjectId.isValid(params.id)) {
                set.status = 400;
                return { error: true, message: 'Invalid ad ID' };
            }

            const ad = await adsService.getById(params.id);
            if (!ad) {
                set.status = 404;
                return { error: true, message: 'Ad not found' };
            }

            return { error: false, data: ad };
        },
        { params: t.Object({ id: t.String() }) }
    )

    .post(
        '/',
        async ({ body, set }) => {
            if (!ObjectId.isValid(body.clinicId)) {
                set.status = 400;
                return { error: true, message: 'Invalid clinic ID' };
            }

            const ad = await adsService.create({
                ...body,
                clinicId: new ObjectId(body.clinicId),
                endDate: body.endDate ? new Date(body.endDate) : null,
            });

            set.status = 201;
            return { error: false, data: ad };
        },
        { body: adsBodySchema }
    )

    .patch(
        '/:id',
        async ({ params, body, set }) => {
            if (!ObjectId.isValid(params.id)) {
                set.status = 400;
                return { error: true, message: 'Invalid ad ID' };
            }

            const ad = await adsService.getById(params.id);
            if (!ad) {
                set.status = 404;
                return { error: true, message: 'Ad not found' };
            }

            const payload: Record<string, unknown> = { ...body };

            if (body.clinicId) {
                if (!ObjectId.isValid(body.clinicId)) {
                    set.status = 400;
                    return { error: true, message: 'Invalid clinic ID' };
                }
                payload.clinicId = new ObjectId(body.clinicId);
            }

            if (body.endDate !== undefined) {
                payload.endDate = body.endDate ? new Date(body.endDate) : null;
            }

            const updated = await adsService.update(params.id, payload);
            return { error: false, data: updated };
        },
        {
            params: t.Object({ id: t.String() }),
            body: t.Partial(adsBodySchema),
        }
    )

    .patch(
        '/:id/status',
        async ({ params, body, set }) => {
            if (!ObjectId.isValid(params.id)) {
                set.status = 400;
                return { error: true, message: 'Invalid ad ID' };
            }

            const ad = await adsService.getById(params.id);
            if (!ad) {
                set.status = 404;
                return { error: true, message: 'Ad not found' };
            }

            const updated = await adsService.updateStatus(params.id, body.status);
            return { error: false, data: updated };
        },
        {
            params: t.Object({ id: t.String() }),
            body: t.Object({ status: t.Enum(IAdsStatusEnum) }),
        }
    );
