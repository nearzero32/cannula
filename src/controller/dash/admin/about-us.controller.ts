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
    .use(AuthPlugin)

    .get('/', async ({ set }) => {
        const data = await aboutUsService.get();

        if (!data) {
            set.status = 404;
            return { error: true, message: 'About us not found' };
        }

        return { error: false, data };
    })

    .patch(
        '/',
        async ({ body }) => {
            const data = await aboutUsService.upsert(body);
            return { error: false, data };
        },
        { body: aboutUsBodySchema }
    );
