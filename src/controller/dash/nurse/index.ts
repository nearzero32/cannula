import Elysia from 'elysia';
import { nurseProfileController } from './profile.controller';
import { nurseHomeCareController } from './home-care.controller';
import { RoleGuardPlugin } from '../../../middleware/authorization.middleware';
import { IUserRoleEnum } from '../../../interfaces/user.interface';

export const nurseController = new Elysia({ prefix: '/nurse' })
    .use(RoleGuardPlugin([IUserRoleEnum.NURSE]))
    .use(nurseProfileController)
    .use(nurseHomeCareController);
