import Elysia from 'elysia';
import aboutUsService from '../../services/about-us.service';

export const mobileAboutUsController = new Elysia({ prefix: '/about-us' })

    .get('/', async ({ set }) => {
        const data = await aboutUsService.get();

        if (!data) {
            set.status = 404;
            return { error: true, message: 'بيانات من نحن غير موجودة', data: null };
        }

        return { error: false, message: 'تم جلب بيانات من نحن بنجاح', data };
    });
