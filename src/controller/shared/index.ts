import Elysia from 'elysia';
import { createUploadController } from './upload.controller';
import { SWAGGER_TAGS } from '../../constants/swagger-tags';
import { IUserRoleEnum, type IUserRole } from '../../interfaces/user.interface';
import { TokenAudienceEnum, type TokenAudience } from '../../constants/jwt';

export interface SharedControllerConfig {
    tag: string;
    allowedRoles: readonly IUserRole[];
    audience: TokenAudience;
}

export function createSharedController(config: SharedControllerConfig) {
    return new Elysia().use(createUploadController(config));
}

export const dashboardSharedController = createSharedController({
    tag: SWAGGER_TAGS.DASHBOARD.SHARED,
    allowedRoles: [IUserRoleEnum.ADMIN, IUserRoleEnum.DOCTOR, IUserRoleEnum.NURSE, IUserRoleEnum.PHARMACY],
    audience: TokenAudienceEnum.DASHBOARD,
});

export const mobileSharedController = createSharedController({
    tag: SWAGGER_TAGS.MOBILE.UPLOADS,
    allowedRoles: [IUserRoleEnum.PATIENT],
    audience: TokenAudienceEnum.MOBILE,
});
