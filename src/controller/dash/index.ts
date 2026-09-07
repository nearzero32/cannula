import Elysia from 'elysia';
import { authController } from './auth.controller';
import { adminController } from './admin/index';
import { doctorController } from './doctor/index';
import { dashboardSharedController } from '../shared/index';
import { nurseController } from './nurse/index';
import { pharmacyController } from './pharmacy/index';

export const dashboardController = new Elysia({
    prefix: '/dash',
})
    .use(authController)
    .use(dashboardSharedController)
    .use(adminController)
    .use(doctorController)
    .use(nurseController)
    .use(pharmacyController);
