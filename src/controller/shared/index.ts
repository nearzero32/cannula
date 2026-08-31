import Elysia from 'elysia';
import { createUploadController } from './upload.controller';
import { SWAGGER_TAGS } from '../../constants/swagger-tags';

export function createSharedController(tag: string) {
    return new Elysia().use(createUploadController(tag));
}

export const sharedController = createSharedController(SWAGGER_TAGS.DASHBOARD.SHARED);
