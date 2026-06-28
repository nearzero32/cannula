import Elysia, { t } from 'elysia';
import { AuthPlugin } from '../../../middleware/auth.middleware';
import aboutUsService from '../../../services/about-us.service';

const aboutUsBodySchema = t.Object({
    name: t.Optional(t.String({ minLength: 1, maxLength: 150 })),
    logo: t.Optional(t.String({ minLength: 1 })),
    description: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
    address: t.Optional(t.Nullable(t.String({ maxLength: 300 }))),
    phone: t.Optional(t.Nullable(t.String({ maxLength: 30 }))),
    website: t.Optional(t.Nullable(t.String())),
    facebook: t.Optional(t.Nullable(t.String())),
    instagram: t.Optional(t.Nullable(t.String())),
});

export const aboutUsController = new Elysia({ prefix: '/about-us' })
    .use(AuthPlugin())

    .get('/', async ({ set }) => {
        const data = await aboutUsService.get();

        if (!data) {
            set.status = 404;
            return { error: true, message: 'بيانات من نحن غير موجودة' };
        }

        return { error: false, message: 'تم جلب بيانات من نحن بنجاح', data };
    })

    .patch(
        '/',
        async ({ body, phrase }) => {
            const data = await aboutUsService.upsert(body, {
                user_id: phrase._id,
                user_name: phrase.role + '_' + phrase._id,
                user_type: phrase.role,
                endpoint: '/dash/about-us',
                source: 'dashboard',
            });
            return { error: false, message: 'تم تحديث بيانات من نحن بنجاح', data };
        },
        { body: aboutUsBodySchema }
    );
