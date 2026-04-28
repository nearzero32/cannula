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
                main_match.clinic_id = new ObjectId(query.clinicId);
            }

            if (query.status) main_match.status = query.status;

            if (query.search) {
                main_match.$or = [
                    { title: { $regex: query.search, $options: 'i' } },
                    { description: { $regex: query.search, $options: 'i' } },
                ];
            }

            const { data, count } = await adsService.getPaginated({ main_match, page, limit });
            const totalPages = Math.ceil(count / limit);

            return {
                error: false,
                message: 'تم جلب الإعلانات بنجاح',
                data,
                pagination: { page, limit, total: count, pages: totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
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
                return { error: true, message: 'معرف الإعلان غير صالح' };
            }

            const ad = await adsService.getById(params.id);
            if (!ad) {
                set.status = 404;
                return { error: true, message: 'الإعلان غير موجود' };
            }

            return { error: false, message: 'تم جلب الإعلان بنجاح', data: ad };
        },
        { params: t.Object({ id: t.String() }) }
    )

    .post(
        '/',
        async ({ body, set }) => {
            if (!ObjectId.isValid(body.clinicId)) {
                set.status = 400;
                return { error: true, message: 'معرف العيادة غير صالح' };
            }

            const ad = await adsService.create({
                ...body,
                clinic_id: new ObjectId(body.clinicId),
                end_date: body.endDate ? new Date(body.endDate) : null,
            });

            set.status = 201;
            return { error: false, message: 'تم إنشاء الإعلان بنجاح', data: ad };
        },
        { body: adsBodySchema }
    )

    .patch(
        '/:id',
        async ({ params, body, set }) => {
            if (!ObjectId.isValid(params.id)) {
                set.status = 400;
                return { error: true, message: 'معرف الإعلان غير صالح' };
            }

            const ad = await adsService.getById(params.id);
            if (!ad) {
                set.status = 404;
                return { error: true, message: 'الإعلان غير موجود' };
            }

            const payload: Record<string, unknown> = { ...body };

            if (body.clinicId) {
                if (!ObjectId.isValid(body.clinicId)) {
                    set.status = 400;
                    return { error: true, message: 'معرف العيادة غير صالح' };
                }
                payload.clinic_id = new ObjectId(body.clinicId);
            }

            if (body.endDate !== undefined) {
                payload.end_date = body.endDate ? new Date(body.endDate) : null;
            }

            const updated = await adsService.update(params.id, payload);
            return { error: false, message: 'تم تحديث الإعلان بنجاح', data: updated };
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
                return { error: true, message: 'معرف الإعلان غير صالح' };
            }

            const ad = await adsService.getById(params.id);
            if (!ad) {
                set.status = 404;
                return { error: true, message: 'الإعلان غير موجود' };
            }

            const updated = await adsService.updateStatus(params.id, body.status);
            return { error: false, message: 'تم تحديث حالة الإعلان بنجاح', data: updated };
        },
        {
            params: t.Object({ id: t.String() }),
            body: t.Object({ status: t.Enum(IAdsStatusEnum) }),
        }
    );
