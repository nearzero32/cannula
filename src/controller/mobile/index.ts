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
import { createSharedController } from '../shared/index';
import { mobileHomeCareController } from './home-care.controller';
import { mobileProfileHealthController } from './profile-health.controller';
import { mobileChildrenController } from './children.controller';
import { mobileAppointmentsController } from './appointments.controller';
import { mobileHomeCareRequestsController } from './home-care-requests.controller';
import { SWAGGER_TAGS } from '../../constants/swagger-tags';
import { mobilePharmacyRequestsController } from './pharmacy-requests.controller';

/** Public mobile routes — no authentication required */
const mobilePublicController = new Elysia()
    .use(mobileAuthController)
    .use(mobileAboutUsController)
    .use(mobileAdsController)
    .use(mobileChronicConditionsController)
    .use(mobileDoctorsController)
    .use(mobileSpecialtiesController)
    .use(mobileHomeCareController);

/** Protected mobile routes — each controller applies AuthPlugin() */
const mobileProtectedController = new Elysia()
    .use(mobileProfileController)
    .use(mobileProfileHealthController)
    .use(mobileChildrenController)
    .use(mobileAppointmentsController)
    .use(mobileHomeCareRequestsController)
    .use(mobilePharmacyRequestsController)
    .use(mobileSuggestionsController)
    .use(mobileDoctorFavoritesController)
    .use(createSharedController(SWAGGER_TAGS.MOBILE.PROFILE));

export const mobileController = new Elysia({
    prefix: '/mobile',
})
    .use(mobilePublicController)
    .use(mobileProtectedController);
