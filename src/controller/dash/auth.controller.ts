import Elysia, { t } from 'elysia';
import { TokenAudienceEnum } from '../../constants/jwt';
import { AuthPlugin } from '../../middleware/auth.middleware';
import userService from '../../services/user.service';
import ActivityLogService from '../../services/activity-log.service';
import { IUserRoleEnum } from '../../interfaces/user.interface';
import { IActivityLogActionEnum, IActivityLogSourceEnum } from '../../interfaces/activity-log.interface';
import { SWAGGER_TAGS } from '../../constants/swagger-tags';
import { BadRequestResponseSchema, GenericDataResponseSchema, ProtectedApiErrorResponses, PublicApiErrorResponses, ServiceUnavailableResponseSchema, SuccessDataWithoutMessageSchema, SuccessResponseWithoutDataSchema, UnauthorizedResponseSchema, ValidationErrorResponseSchema } from '../../schemas/api-response.schema';
import { RoleGuardPlugin } from '../../middleware/authorization.middleware';
import sessionService from '../../services/session.service';
import { DomainError } from '../../services/domain-error';
import { resolveClientIp } from '../../services/client-ip.service';

export const DASHBOARD_ROLES = [IUserRoleEnum.ADMIN, IUserRoleEnum.DOCTOR, IUserRoleEnum.NURSE, IUserRoleEnum.PHARMACY];

export const authController = new Elysia({
    prefix: '/auth',
    detail: { tags: [SWAGGER_TAGS.DASHBOARD.AUTH] },
})

    .post(
        '/login',
        async ({ body, request, server, set }) => {
            const user = await userService.findByCredentials({
                phone: body.phone,
                password: body.password,
                roles: DASHBOARD_ROLES,
            });

            if (!user) {
                set.status = 401;
                return { error: true, message: 'رقم الهاتف أو كلمة المرور غير صحيحة' };
            }

            if (user.status !== 'active') {
                set.status = 401;
                return { error: true, message: 'الحساب غير مفعّل' };
            }

            const user_id = (user._id as any).toString();
            const tokens = await sessionService.create(user, TokenAudienceEnum.DASHBOARD, {
                deviceId: body.deviceId, deviceName: body.deviceName, platform: body.platform,
            }, resolveClientIp(request,server));

            try {
                await ActivityLogService.logActivity({
                    user_id: user_id,
                    user_name: user.role + '_' + user_id,
                    user_type: user.role,
                    method: 'POST',
                    endpoint: '/dash/auth/login',
                    action: IActivityLogActionEnum.OTHER,
                    collection_name: 'users',
                    document_id: user_id,
                    request_body: { phone: body.phone },
                    source: IActivityLogSourceEnum.DASHBOARD,
                });
            } catch {}

            return {
                error: false,
                message: 'تم تسجيل الدخول بنجاح',
                data: {
                    ...tokens,
                    user: {
                        _id: user_id,
                        full_name: user.full_name,
                        phone: user.phone,
                        role: user.role,
                        status: user.status,
                    },
                },
            };
        },
        {
            body: t.Object({
                phone: t.String({ minLength: 1 }),
                password: t.String({ minLength: 1 }),
                deviceId: t.Optional(t.String({ maxLength: 200 })),
                deviceName: t.Optional(t.String({ maxLength: 200 })),
                platform: t.Optional(t.String({ maxLength: 100 })),
            }),
            response: {
                200: GenericDataResponseSchema, 400: BadRequestResponseSchema, 401: UnauthorizedResponseSchema,
                422: ValidationErrorResponseSchema, ...PublicApiErrorResponses,
            },
        }
    )

    .post(
        '/refresh',
        async ({ body, request, server, set }) => {
            try {
                return { error: false, data: await sessionService.refresh(body.refreshToken, TokenAudienceEnum.DASHBOARD, { ip: resolveClientIp(request,server) }) };
            } catch (error) {
                if (!(error instanceof DomainError)) throw error;
                set.status = error.status;
                return { error: true, message: error.message };
            }
        },
        {
            body: t.Object({
                refreshToken: t.String({ minLength: 1 }),
            }),
            response: {
                200: SuccessDataWithoutMessageSchema, 400: BadRequestResponseSchema, 401: UnauthorizedResponseSchema,
                422: ValidationErrorResponseSchema, 503: ServiceUnavailableResponseSchema, ...PublicApiErrorResponses,
            },
        }
    )

    .group('', (app) =>
        app.use(AuthPlugin()).use(RoleGuardPlugin(DASHBOARD_ROLES)).get('/sessions', async ({ phrase }) => {
            const sessions = await sessionService.list(phrase._id);
            return { error: false, data: sessions.map(session => ({ ...session, current: session.sid === phrase.sid })) };
        }, { response: { 200: SuccessDataWithoutMessageSchema, 503: ServiceUnavailableResponseSchema, ...ProtectedApiErrorResponses } })
        .post('/logout', async ({ phrase }) => {
            await sessionService.revoke(phrase._id, phrase.sid, { reasonCode: 'USER_LOGOUT' });

            try {
                await ActivityLogService.logActivity({
                    user_id: phrase._id,
                    user_name: phrase.role + '_' + phrase._id,
                    user_type: phrase.role,
                    method: 'POST',
                    endpoint: '/dash/auth/logout',
                    action: IActivityLogActionEnum.OTHER,
                    collection_name: 'users',
                    document_id: phrase._id,
                    request_body: {},
                    source: IActivityLogSourceEnum.DASHBOARD,
                });
            } catch {}

            return { error: false, message: 'تم تسجيل الخروج بنجاح' };
        }, { response: { 200: SuccessResponseWithoutDataSchema, 503: ServiceUnavailableResponseSchema, ...ProtectedApiErrorResponses } })
        .post('/logout-all', async ({ phrase }) => {
            await sessionService.revokeAll(phrase._id, { reasonCode: 'USER_LOGOUT_ALL' });
            return { error: false, message: 'تم تسجيل الخروج من جميع الأجهزة بنجاح' };
        }, { response: { 200: SuccessResponseWithoutDataSchema, 503: ServiceUnavailableResponseSchema, ...ProtectedApiErrorResponses } })
    );
