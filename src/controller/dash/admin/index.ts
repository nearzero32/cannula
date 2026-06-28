import Elysia from 'elysia';
import { clinicsController } from './clinics.controller';
import { activityLogController } from './activity-log.controller';
import { aboutUsController } from './about-us.controller';
import { adsController } from './ads.controller';
import { specialtiesController } from './specialties.controller';
import { patientsController } from './patients.controller';
import { appointmentsController } from './appointments.controller';
import { notificationsController } from './notifications.controller';
import { doctorsController } from './doctors.controller';

export const adminController = new Elysia({ prefix: '/admin' })
    .use(clinicsController)
    .use(activityLogController)
    .use(aboutUsController)
    .use(adsController)
    .use(specialtiesController)
    .use(doctorsController)
    .use(patientsController)
    .use(appointmentsController)
    .use(notificationsController);
