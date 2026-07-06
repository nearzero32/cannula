import Elysia, { t } from 'elysia';
import mongoose from 'mongoose';
import { AuthPlugin } from '../../../middleware/auth.middleware';
import suggestionService from '../../../services/suggestion.service';
import { IActivityLogSourceEnum } from '../../../interfaces/activity-log.interface';

const ObjectId = mongoose.Types.ObjectId;

const userLookupPipeline = [
    {
        $lookup: {
            from: 'users',
            let: { uid: '$user_id' },
            pipeline: [
                { $match: { $expr: { $eq: ['$_id', '$$uid'] } } },
                { $project: { full_name: 1, phone: 1, role: 1 } },
            ],
            as: 'user',
        },
    },
    {
        $addFields: {
            _matched_user: { $arrayElemAt: ['$user', 0] },
        },
    },
    {
        $addFields: {
            user_name: { $ifNull: ['$_matched_user.full_name', null] },
            user_phone: { $ifNull: ['$_matched_user.phone', null] },
            user_role: { $ifNull: ['$_matched_user.role', null] },
        },
    },
    {
        $lookup: {
            from: 'users',
            let: { did: '$deleted_by' },
            pipeline: [
                { $match: { $expr: { $eq: ['$_id', '$$did'] } } },
                { $project: { full_name: 1 } },
            ],
            as: 'deleted_by_user',
        },
    },
    {
        $addFields: {
            _matched_deleted_by: { $arrayElemAt: ['$deleted_by_user', 0] },
        },
    },
    {
        $addFields: {
            deleted_by_name: { $ifNull: ['$_matched_deleted_by.full_name', null] },
        },
    },
    {
        $project: {
            _id: 1,
            suggestion: 1,
            user_id: 1,
            user_name: 1,
            user_phone: 1,
            user_role: 1,
            is_deleted: 1,
            deleted_at: 1,
            deleted_by: 1,
            deleted_by_name: 1,
            createdAt: 1,
        },
    },
];

export const suggestionsController = new Elysia({ prefix: '/suggestions' })
    .use(AuthPlugin())

    .get(
        '/',
        async ({ query }) => {
            const page = Math.max(1, Number(query.page) || 1);
            const limit = Math.min(100, Math.max(1, Number(query.limit) || 10));

            const main_match: Record<string, unknown> = {};

            if (query.is_deleted === 'true') {
                main_match.is_deleted = true;
            } else {
                main_match.is_deleted = false;
            }

            if (query.user_id && ObjectId.isValid(query.user_id)) {
                main_match.user_id = new ObjectId(query.user_id);
            }

            if (query.search) {
                main_match.suggestion = { $regex: query.search, $options: 'i' };
            }

            const { data, count } = await suggestionService.getPaginated({
                main_match,
                additional_pipeline: userLookupPipeline,
                page,
                limit,
            });
            const totalPages = Math.ceil(count / limit);

            return {
                error: false,
                message: 'تم جلب الاقتراحات بنجاح',
                data,
                pagination: { page, limit, total: count, pages: totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
            };
        },
        {
            query: t.Object({
                page: t.Optional(t.String()),
                limit: t.Optional(t.String()),
                user_id: t.Optional(t.String()),
                search: t.Optional(t.String()),
                is_deleted: t.Optional(t.Union([t.Literal('true'), t.Literal('false')])),
            }),
        }
    )

    .delete(
        '/:id/delete',
        async ({ params, phrase, set }) => {
            if (!ObjectId.isValid(params.id)) {
                set.status = 400;
                return { error: true, message: 'معرف الاقتراح غير صالح' };
            }

            const item = await suggestionService.getById(params.id, true);
            if (!item) {
                set.status = 404;
                return { error: true, message: 'الاقتراح غير موجود' };
            }

            if (item.is_deleted) {
                set.status = 400;
                return { error: true, message: 'الاقتراح محذوف مسبقاً' };
            }

            const updated = await suggestionService.softDelete(params.id, phrase._id, {
                user_id: phrase._id,
                user_name: phrase.role + '_' + phrase._id,
                user_type: phrase.role,
                endpoint: '/dash/admin/suggestions/' + params.id + '/delete',
                source: IActivityLogSourceEnum.DASHBOARD,
            });

            return { error: false, message: 'تم حذف الاقتراح بنجاح', data: updated };
        },
        { params: t.Object({ id: t.String() }) }
    )

    .put(
        '/:id/restore',
        async ({ params, phrase, set }) => {
            if (!ObjectId.isValid(params.id)) {
                set.status = 400;
                return { error: true, message: 'معرف الاقتراح غير صالح' };
            }

            const item = await suggestionService.getById(params.id, true);
            if (!item) {
                set.status = 404;
                return { error: true, message: 'الاقتراح غير موجود' };
            }

            if (!item.is_deleted) {
                set.status = 400;
                return { error: true, message: 'الاقتراح غير محذوف' };
            }

            const updated = await suggestionService.restore(params.id, {
                user_id: phrase._id,
                user_name: phrase.role + '_' + phrase._id,
                user_type: phrase.role,
                endpoint: '/dash/admin/suggestions/' + params.id + '/restore',
                source: IActivityLogSourceEnum.DASHBOARD,
            });

            return { error: false, message: 'تم استعادة الاقتراح بنجاح', data: updated };
        },
        { params: t.Object({ id: t.String() }) }
    );
