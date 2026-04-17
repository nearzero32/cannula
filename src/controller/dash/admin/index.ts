import Elysia from 'elysia';
import { AuthPlugin } from '../../../middleware/auth.middleware';
import { clinicsController } from './clinics.controller';
import { activityLogController } from './activity-log.controller';
import { aboutUsController } from './about-us.controller';
import { adsController } from './ads.controller';
import { specialtiesController } from './specialties.controller';

export const adminController = new Elysia({ prefix: '/admin' })
    .use(AuthPlugin)
    .use(clinicsController)
    .use(activityLogController)
    .use(aboutUsController)
    .use(adsController)
    .use(specialtiesController);
