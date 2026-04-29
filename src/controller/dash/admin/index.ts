import Elysia from 'elysia';
import { AuthPlugin } from '../../../middleware/auth.middleware';
import { clinicsController } from './clinics.controller';
import { activityLogController } from './activity-log.controller';
import { aboutUsController } from './about-us.controller';
import { adsController } from './ads.controller';
import { specialtiesController } from './specialties.controller';
import { patientsController } from './patients.controller';
import { appointmentsController } from './appointments.controller';

export const adminController = new Elysia({ prefix: '/admin' })
    .use(AuthPlugin)
    .use(clinicsController)
    .use(activityLogController)
    .use(aboutUsController)
    .use(adsController)
    .use(specialtiesController)
    .use(patientsController)
    .use(appointmentsController);
