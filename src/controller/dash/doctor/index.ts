import Elysia from 'elysia';
import { doctorActivityLogController } from './activity-log.controller';
import { doctorSecretaryController } from './secretary.controller';
import { doctorProfileController } from './profile.controller';
import { doctorAppointmentsController } from './appointments.controller';
import { doctorSuggestionsController } from './suggestions.controller';
import { RoleGuardPlugin } from '../../../middleware/authorization.middleware';
import { IUserRoleEnum } from '../../../interfaces/user.interface';

export const doctorController = new Elysia({ prefix: '/doctor' })
    .use(RoleGuardPlugin([IUserRoleEnum.DOCTOR]))
    .use(doctorProfileController)
    .use(doctorActivityLogController)
    .use(doctorSecretaryController)
    .use(doctorAppointmentsController)
    .use(doctorSuggestionsController);
