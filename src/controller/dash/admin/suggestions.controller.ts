import Elysia, { t } from 'elysia';
import mongoose from 'mongoose';
import { AuthPlugin } from '../../../middleware/auth.middleware';
import suggestionService from '../../../services/suggestion.service';

const ObjectId = mongoose.Types.ObjectId;

const userLookupPipeline = [
    {
        $lookup: {
            from: 'users',
            localField: 'user_id',
            foreignField: '_id',
            as: 'user',
        },
    },
    {
        $unwind: {
            path: '$user',
            preserveNullAndEmptyArrays: true,
        },
    },
    {
        $project: {
            suggestion: 1,
            user_id: 1,
            createdAt: 1,
            updatedAt: 1,
            user: {
                _id: '$user._id',
                full_name: '$user.full_name',
                phone: '$user.phone',
                role: '$user.role',
            },
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
            }),
        }
    )

    .get(
        '/:id',
        async ({ params, set }) => {
            if (!ObjectId.isValid(params.id)) {
                set.status = 400;
                return { error: true, message: 'معرف الاقتراح غير صالح' };
            }

            const { data } = await suggestionService.getPaginated({
                main_match: { _id: new ObjectId(params.id) },
                additional_pipeline: userLookupPipeline,
                limit: 1,
            });

            const item = data[0];
            if (!item) {
                set.status = 404;
                return { error: true, message: 'الاقتراح غير موجود' };
            }

            return { error: false, message: 'تم جلب الاقتراح بنجاح', data: item };
        },
        { params: t.Object({ id: t.String() }) }
    );
