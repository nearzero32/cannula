import Elysia from 'elysia'; import {pharmacyProfileController} from './profile.controller'; import {pharmacyTreatmentRequestsController} from './treatment-requests.controller';
export const pharmacyController=new Elysia({prefix:'/pharmacy'}).use(pharmacyProfileController).use(pharmacyTreatmentRequestsController);
