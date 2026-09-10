import Elysia from 'elysia';
import { SWAGGER_TAGS } from '../../constants/swagger-tags';
import aboutUsService from '../../services/about-us.service';
import { GenericDataResponseSchema, NotFoundResponseSchema, PublicApiErrorResponses } from '../../schemas/api-response.schema';
import { PUBLIC_OPENAPI_SECURITY } from '../../constants/openapi-security';

export const mobileAboutUsController = new Elysia({
    prefix: '/about-us',
    detail: { tags: [SWAGGER_TAGS.MOBILE.ABOUT_US], security: PUBLIC_OPENAPI_SECURITY },
})

    .get('/', async ({ set }) => {
        const data = await aboutUsService.get();

        if (!data) {
            set.status = 404;
            return { error: true, message: 'بيانات من نحن غير موجودة', data: null };
        }

        return { error: false, message: 'تم جلب بيانات من نحن بنجاح', data };
    }, { response: { 200: GenericDataResponseSchema, 404: NotFoundResponseSchema, ...PublicApiErrorResponses } });
