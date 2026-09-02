import Elysia from 'elysia'; import {pharmacyProfileController} from './profile.controller'; import {pharmacyTreatmentRequestsController} from './treatment-requests.controller';
import { RoleGuardPlugin } from '../../../middleware/authorization.middleware'; import { IUserRoleEnum } from '../../../interfaces/user.interface';
export const pharmacyController=new Elysia({prefix:'/pharmacy'}).use(RoleGuardPlugin([IUserRoleEnum.PHARMACY])).use(pharmacyProfileController).use(pharmacyTreatmentRequestsController);
