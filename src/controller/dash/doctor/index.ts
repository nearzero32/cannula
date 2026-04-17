import Elysia from 'elysia';
import { AuthPlugin } from '../../../middleware/auth.middleware';
import { doctorActivityLogController } from './activity-log.controller';
import { doctorSecretaryController } from './secretary.controller';
import { doctorProfileController } from './profile.controller';

export const doctorController = new Elysia({ prefix: '/doctor' })
    .use(AuthPlugin)
    .use(doctorProfileController)
    .use(doctorActivityLogController)
    .use(doctorSecretaryController);
