import Elysia, { t } from 'elysia';
import { AuthPlugin } from '../../../middleware/auth.middleware';
import mongoose from 'mongoose';
import adsService from '../../../services/ads.service';
import { IAdsStatusEnum } from '../../../interfaces/ads.interface';

const ObjectId = mongoose.Types.ObjectId;

function withIsEnded(ad: unknown) {
    const obj =
        ad && typeof ad === 'object' && 'toObject' in ad && typeof (ad as { toObject: () => Record<string, unknown> }).toObject === 'function'
            ? (ad as { toObject: () => Record<string, unknown> }).toObject()
            : { ...(ad as Record<string, unknown>) };

    const end_date = obj.end_date as Date | string | null | undefined;
    const is_ended = end_date != null && new Date(end_date) < new Date();

    return { ...obj, is_ended };
}

const adsBodySchema = t.Object({
    title: t.Optional(t.Nullable(t.String({ maxLength: 200 }))),
    description: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
    image: t.String({ minLength: 1 }),
    link: t.Optional(t.Nullable(t.String())),
    clinic_id: t.Optional(t.Nullable(t.String())),
    doctor_id: t.Optional(t.Nullable(t.String())),
    end_date: t.Optional(t.Nullable(t.String())),
});

export const adsController = new Elysia({ prefix: '/ads' })
    .use(AuthPlugin())

    .get(
        '/',
        async ({ query }) => {
            const page = Math.max(1, Number(query.page) || 1);
            const limit = Math.min(100, Math.max(1, Number(query.limit) || 10));

            const main_match: Record<string, unknown> = {};

            if (query.clinic_id && ObjectId.isValid(query.clinic_id)) {
                main_match.clinic_id = new ObjectId(query.clinic_id);
            }

            if (query.doctor_id && ObjectId.isValid(query.doctor_id)) {
                main_match.doctor_id = new ObjectId(query.doctor_id);
            }

            if (query.status) main_match.status = query.status;

            const andConditions: Record<string, unknown>[] = [];

            if (query.is_ended === 'true') {
                andConditions.push({ end_date: { $ne: null, $lt: new Date() } });
            } else if (query.is_ended === 'false') {
                andConditions.push({
                    $or: [{ end_date: null }, { end_date: { $gte: new Date() } }],
                });
            }

            if (query.search) {
                andConditions.push({
                    $or: [
                        { title: { $regex: query.search, $options: 'i' } },
                        { description: { $regex: query.search, $options: 'i' } },
                    ],
                });
            }

            if (andConditions.length) main_match.$and = andConditions;

            const { data, count } = await adsService.getPaginated({ main_match, page, limit });
            const totalPages = Math.ceil(count / limit);

            return {
                error: false,
                message: 'تم جلب الإعلانات بنجاح',
                data: data.map(withIsEnded),
                pagination: { page, limit, total: count, pages: totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
            };
        },
        {
            query: t.Object({
                page: t.Optional(t.String()),
                limit: t.Optional(t.String()),
                clinic_id: t.Optional(t.String()),
                doctor_id: t.Optional(t.String()),
                status: t.Optional(t.Enum(IAdsStatusEnum)),
                is_ended: t.Optional(t.Union([t.Literal('true'), t.Literal('false')])),
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

            return { error: false, message: 'تم جلب الإعلان بنجاح', data: withIsEnded(ad) };
        },
        { params: t.Object({ id: t.String() }) }
    )

    .post(
        '/',
        async ({ body, phrase, set }) => {

            if (body.clinic_id && !ObjectId.isValid(body.clinic_id)) {
                set.status = 400;
                return { error: true, message: 'معرف العيادة غير صالح' };
            }

            if (body.doctor_id && !ObjectId.isValid(body.doctor_id)) {
                set.status = 400;
                return { error: true, message: 'معرف الطبيب غير صالح' };
            }

            const ad = await adsService.create({
                title: body.title,
                description: body.description,
                image: body.image,
                link: body.link,
                clinic_id: body.clinic_id ? new ObjectId(body.clinic_id) : null,
                doctor_id: body.doctor_id ? new ObjectId(body.doctor_id) : null,
                end_date: body.end_date ? new Date(body.end_date) : null,
            }, {
                user_id: phrase._id,
                user_name: phrase.role + '_' + phrase._id,
                user_type: phrase.role,
                endpoint: '/dash/ads',
                source: 'dashboard',
            });

            set.status = 201;
            return { error: false, message: 'تم إنشاء الإعلان بنجاح', data: withIsEnded(ad) };
        },
        { body: adsBodySchema }
    )

    .put(
        '/:id',
        async ({ params, body, phrase, set }) => {
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

            if (body.clinic_id !== undefined) {
                if (body.clinic_id && !ObjectId.isValid(body.clinic_id)) {
                    set.status = 400;
                    return { error: true, message: 'معرف العيادة غير صالح' };
                }
                payload.clinic_id = body.clinic_id ? new ObjectId(body.clinic_id) : null;
            }

            if (body.doctor_id !== undefined) {
                if (body.doctor_id && !ObjectId.isValid(body.doctor_id)) {
                    set.status = 400;
                    return { error: true, message: 'معرف الطبيب غير صالح' };
                }
                payload.doctor_id = body.doctor_id ? new ObjectId(body.doctor_id) : null;
            }

            if (body.end_date !== undefined) {
                payload.end_date = body.end_date ? new Date(body.end_date) : null;
            }

            const updated = await adsService.update(params.id, payload, {
                user_id: phrase._id,
                user_name: phrase.role + '_' + phrase._id,
                user_type: phrase.role,
                endpoint: '/dash/ads/' + params.id,
                source: 'dashboard',
            });
            return { error: false, message: 'تم تحديث الإعلان بنجاح', data: withIsEnded(updated) };
        },
        {
            params: t.Object({ id: t.String() }),
            body: t.Partial(adsBodySchema),
        }
    )

    .patch(
        '/:id/status',
        async ({ params, body, phrase, set }) => {
            if (!ObjectId.isValid(params.id)) {
                set.status = 400;
                return { error: true, message: 'معرف الإعلان غير صالح' };
            }

            const ad = await adsService.getById(params.id);
            if (!ad) {
                set.status = 404;
                return { error: true, message: 'الإعلان غير موجود' };
            }

            const updated = await adsService.updateStatus(params.id, body.status, {
                user_id: phrase._id,
                user_name: phrase.role + '_' + phrase._id,
                user_type: phrase.role,
                endpoint: '/dash/ads/' + params.id + '/status',
                source: 'dashboard',
            });
            return { error: false, message: 'تم تحديث حالة الإعلان بنجاح', data: withIsEnded(updated) };
        },
        {
            params: t.Object({ id: t.String() }),
            body: t.Object({ status: t.Enum(IAdsStatusEnum) }),
        }
    );
