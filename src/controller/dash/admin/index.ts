import Elysia from 'elysia';
import { clinicsController } from './clinics.controller';
import { activityLogController } from './activity-log.controller';
import { aboutUsController } from './about-us.controller';
import { adsController } from './ads.controller';
import { specialtiesController } from './specialties.controller';
import { chronicConditionsController } from './chronic-conditions.controller';
import { patientsController } from './patients.controller';
import { appointmentsController } from './appointments.controller';
import { notificationsController } from './notifications.controller';
import { doctorsController } from './doctors.controller';
import { suggestionsController } from './suggestions.controller';
import { homeCareAdminController } from './home-care.controller';
import { nursesAdminController } from './nurses.controller';
import { pharmaciesAdminController } from './pharmacies.controller';
import { pharmacyRequestsAdminController } from './pharmacy-requests.controller';
import { authSecurityController } from './auth-security.controller';
import { RoleGuardPlugin } from '../../../middleware/authorization.middleware';
import { IUserRoleEnum } from '../../../interfaces/user.interface';

export const adminController = new Elysia({ prefix: '/admin' })
    .use(RoleGuardPlugin([IUserRoleEnum.ADMIN]))
    .use(clinicsController)
    .use(activityLogController)
    .use(aboutUsController)
    .use(adsController)
    .use(specialtiesController)
    .use(chronicConditionsController)
    .use(doctorsController)
    .use(patientsController)
    .use(appointmentsController)
    .use(notificationsController)
    .use(suggestionsController)
    .use(nursesAdminController)
    .use(pharmaciesAdminController)
    .use(pharmacyRequestsAdminController)
    .use(homeCareAdminController)
    .use(authSecurityController);
