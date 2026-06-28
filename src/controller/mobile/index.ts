import Elysia from 'elysia';
import { mobileAboutUsController } from './about-us.controller';
import { mobileAdsController } from './ads.controller';
import { sharedController } from '../shared/index';

/** Public mobile routes — no authentication required */
const mobilePublicController = new Elysia()
    .use(mobileAboutUsController)
    .use(mobileAdsController);

/** Protected mobile routes — each controller applies AuthPlugin() */
const mobileProtectedController = new Elysia()
    .use(sharedController);
    // .use(mobileAppointmentsController)
    // .use(mobileProfileController)

export const mobileController = new Elysia({
    prefix: '/mobile',
    detail: { tags: ['Mobile'] },
})
    .use(mobilePublicController)
    .use(mobileProtectedController);
