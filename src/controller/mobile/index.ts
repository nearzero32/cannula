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
import { sharedController } from '../shared/index';

/** Public mobile routes — no authentication required */
const mobilePublicController = new Elysia()
    .use(mobileAuthController)
    .use(mobileAboutUsController)
    .use(mobileAdsController)
    .use(mobileChronicConditionsController)
    .use(mobileDoctorsController)
    .use(mobileSpecialtiesController);

/** Protected mobile routes — each controller applies AuthPlugin() */
const mobileProtectedController = new Elysia()
    .use(mobileProfileController)
    .use(mobileSuggestionsController)
    .use(mobileDoctorFavoritesController)
    .use(sharedController);
// .use(mobileAppointmentsController)
// .use(mobileProfileController)

export const mobileController = new Elysia({
    prefix: '/mobile',
    detail: { tags: ['Mobile'] },
})
    .use(mobilePublicController)
    .use(mobileProtectedController);
