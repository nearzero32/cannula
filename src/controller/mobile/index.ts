import Elysia from 'elysia';
import { mobileAboutUsController } from './about-us.controller';
import { mobileAdsController } from './ads.controller';

export const mobileController = new Elysia({
    prefix: '/mobile',
    detail: { tags: ['Mobile'] },
})
    .use(mobileAboutUsController)
    .use(mobileAdsController);
