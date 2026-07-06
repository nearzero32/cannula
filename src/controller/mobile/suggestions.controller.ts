import Elysia, { t } from 'elysia';
import mongoose from 'mongoose';
import { AuthPlugin } from '../../middleware/auth.middleware';
import suggestionService from '../../services/suggestion.service';
import { IActivityLogSourceEnum } from '../../interfaces/activity-log.interface';

const ObjectId = mongoose.Types.ObjectId;

const createSuggestionBodySchema = t.Object({
    suggestion: t.String({ minLength: 1, maxLength: 2000 }),
});

export const mobileSuggestionsController = new Elysia({ prefix: '/suggestions' })
    .use(AuthPlugin())

    .get(
        '/',
        async ({ phrase, query }) => {
            const page = Math.max(1, Number(query.page) || 1);
            const limit = Math.min(100, Math.max(1, Number(query.limit) || 10));

            const { data, count } = await suggestionService.getPaginated({
                main_match: { user_id: new ObjectId(phrase._id) },
                page,
                limit,
            });
            const totalPages = Math.ceil(count / limit);

            return {
                error: false,
                message: 'تم جلب اقتراحاتك بنجاح',
                data,
                pagination: { page, limit, total: count, pages: totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
            };
        },
        {
            query: t.Object({
                page: t.Optional(t.String()),
                limit: t.Optional(t.String()),
            }),
        }
    )

    .post(
        '/',
        async ({ body, phrase, set }) => {
            const item = await suggestionService.create(
                {
                    user_id: new ObjectId(phrase._id),
                    suggestion: body.suggestion,
                },
                {
                    user_id: phrase._id,
                    user_name: phrase.role + '_' + phrase._id,
                    user_type: phrase.role,
                    endpoint: '/mobile/suggestions',
                    source: IActivityLogSourceEnum.MOBILE,
                }
            );

            set.status = 201;
            return { error: false, message: 'تم إرسال الاقتراح بنجاح', data: item };
        },
        { body: createSuggestionBodySchema }
    );
