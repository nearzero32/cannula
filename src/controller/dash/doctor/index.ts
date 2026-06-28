import Elysia from 'elysia';
import { doctorActivityLogController } from './activity-log.controller';
import { doctorSecretaryController } from './secretary.controller';
import { doctorProfileController } from './profile.controller';
import { doctorAppointmentsController } from './appointments.controller';

export const doctorController = new Elysia({ prefix: '/doctor' })
    .use(doctorProfileController)
    .use(doctorActivityLogController)
    .use(doctorSecretaryController)
    .use(doctorAppointmentsController);
