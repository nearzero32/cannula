import Elysia from 'elysia';
import { nurseProfileController } from './profile.controller';
import { nurseHomeCareController } from './home-care.controller';

export const nurseController = new Elysia({ prefix: '/nurse' }).use(nurseProfileController).use(nurseHomeCareController);
