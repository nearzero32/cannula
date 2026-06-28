import Elysia from 'elysia';
import { authController } from './auth.controller';
import { adminController } from './admin/index';
import { doctorController } from './doctor/index';
import { sharedController } from '../shared/index';

export const dashboardController = new Elysia({
    prefix: '/dash',
    detail: { tags: ['Dash'] },
})
    .use(authController)
    .use(sharedController)
    .use(adminController)
    .use(doctorController);
