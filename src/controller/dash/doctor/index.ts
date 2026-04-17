import Elysia from 'elysia';
import { AuthPlugin } from '../../../middleware/auth.middleware';

export const doctorController = new Elysia({ prefix: '/doctor' }).use(AuthPlugin);
