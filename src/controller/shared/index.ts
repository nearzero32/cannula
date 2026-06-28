import Elysia from 'elysia';
import { uploadController } from './upload.controller';

export const sharedController = new Elysia()
    .use(uploadController);
