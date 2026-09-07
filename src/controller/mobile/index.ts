import Elysia from 'elysia';
import { mobileAboutUsController } from './about-us.controller';
import { mobileAdsController } from './ads.controller';
import { mobileAuthController } from './auth.controller';
import { mobileChronicConditionsController } from './chronic-conditions.controller';
import { mobileDoctorsController } from './doctors.controller';
import { mobileSpecialtiesController } from './specialties.controller';
import { mobileProfileController } from './profile.controller';
import { mobileSuggestionsController } from './suggestions.controller';
import { mobileDoctorFavoritesController } from './doctor-favorites.controller';
import { mobileSharedController } from '../shared/index';
import { mobileHomeCareController } from './home-care.controller';
import { mobileProfileHealthController } from './profile-health.controller';
import { mobileChildrenController } from './children.controller';
import { mobileAppointmentsController } from './appointments.controller';
import { mobileHomeCareRequestsController } from './home-care-requests.controller';
import { mobilePharmacyRequestsController } from './pharmacy-requests.controller';
import { mobileNotificationsController } from './notifications.controller';
import { RoleGuardPlugin } from '../../middleware/authorization.middleware';
import { IUserRoleEnum } from '../../interfaces/user.interface';
import { mobileMedicationsController } from './medications.controller';
import { mobileMedicationDosesController } from './medication-doses.controller';
import { mobileMedicationRemindersController } from './medication-reminders.controller';

/** Public mobile routes — no authentication required */
const mobilePublicController = new Elysia()
    .use(mobileAuthController)
    .use(mobileAboutUsController)
    .use(mobileAdsController)
    .use(mobileChronicConditionsController)
    .use(mobileDoctorsController)
    .use(mobileSpecialtiesController)
    .use(mobileHomeCareController)
    .use(mobileNotificationsController);

/** Protected mobile routes — each controller explicitly applies the mobile AuthPlugin audience. */
const mobileProtectedController = new Elysia()
    .use(RoleGuardPlugin([IUserRoleEnum.PATIENT]))
    .use(mobileProfileController)
    .use(mobileProfileHealthController)
    .use(mobileChildrenController)
    .use(mobileAppointmentsController)
    .use(mobileHomeCareRequestsController)
    .use(mobilePharmacyRequestsController)
    .use(mobileSuggestionsController)
    .use(mobileDoctorFavoritesController)
    .use(mobileMedicationsController)
    .use(mobileMedicationDosesController)
    .use(mobileMedicationRemindersController)
    .use(mobileSharedController);

export const mobileController = new Elysia({
    prefix: '/mobile',
})
    .use(mobilePublicController)
    .use(mobileProtectedController);
