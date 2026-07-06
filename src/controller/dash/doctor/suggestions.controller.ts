import Elysia, { t } from 'elysia';
import mongoose from 'mongoose';
import { AuthPlugin } from '../../../middleware/auth.middleware';
import suggestionService from '../../../services/suggestion.service';
import { IUserRoleEnum } from '../../../interfaces/user.interface';
import { IActivityLogSourceEnum } from '../../../interfaces/activity-log.interface';

const ObjectId = mongoose.Types.ObjectId;

const createSuggestionBodySchema = t.Object({
    suggestion: t.String({ minLength: 1, maxLength: 2000 }),
});

export const doctorSuggestionsController = new Elysia({ prefix: '/suggestions' })
    .use(AuthPlugin())

    .get(
        '/',
        async ({ phrase, query, set }) => {
            if (phrase.role !== IUserRoleEnum.DOCTOR) {
                set.status = 403;
                return { error: true, message: 'غير مصرح لك بالوصول' };
            }

            const page = Math.max(1, Number(query.page) || 1);
            const limit = Math.min(100, Math.max(1, Number(query.limit) || 10));

            const { data, count } = await suggestionService.getPaginated({
                main_match: { user_id: new ObjectId(phrase._id), is_deleted: false },
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
            if (phrase.role !== IUserRoleEnum.DOCTOR) {
                set.status = 403;
                return { error: true, message: 'غير مصرح لك بالوصول' };
            }

            const item = await suggestionService.create(
                {
                    user_id: new ObjectId(phrase._id),
                    suggestion: body.suggestion,
                },
                {
                    user_id: phrase._id,
                    user_name: phrase.role + '_' + phrase._id,
                    user_type: phrase.role,
                    endpoint: '/dash/doctor/suggestions',
                    source: IActivityLogSourceEnum.DASHBOARD,
                }
            );

            set.status = 201;
            return { error: false, message: 'تم إرسال الاقتراح بنجاح', data: item };
        },
        { body: createSuggestionBodySchema }
    );
