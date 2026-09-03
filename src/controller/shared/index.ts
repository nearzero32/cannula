import Elysia from 'elysia';
import { createUploadController } from './upload.controller';
import { SWAGGER_TAGS } from '../../constants/swagger-tags';
import { IUserRoleEnum, type IUserRole } from '../../interfaces/user.interface';
import { TokenAudienceEnum, type TokenAudience } from '../../constants/jwt';

export function createSharedController(tag: string, allowedRoles: readonly IUserRole[], audience: TokenAudience = TokenAudienceEnum.DASHBOARD) {
    return new Elysia().use(createUploadController(tag, allowedRoles, audience));
}

export const sharedController = createSharedController(SWAGGER_TAGS.DASHBOARD.SHARED, [
    IUserRoleEnum.ADMIN, IUserRoleEnum.DOCTOR, IUserRoleEnum.NURSE, IUserRoleEnum.PHARMACY,
], TokenAudienceEnum.DASHBOARD);
