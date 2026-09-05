import { TokenAudienceEnum, verifyAccessToken, type TokenAudience } from '../constants/jwt';
import Elysia from 'elysia';
import sessionService from '../services/session.service';
import { IUserRoleEnum } from '../interfaces/user.interface';

/** Validates a typed access JWT against its logical Redis session. */
export function AuthPlugin(audience: TokenAudience = TokenAudienceEnum.DASHBOARD) {
    return new Elysia().derive({ as: 'scoped' }, async ({ headers, request, status }) => {
        const auth = headers.authorization;
        if (!auth || auth === 'null' || auth === 'undefined' || auth.length === 0) return status(401, { error: true, message: 'Authorization is required' });
        const path = new URL(request.url).pathname;
        const bearer = verifyAccessToken(auth, audience);
        if (!bearer) return status(401, { error: true, message: 'Invalid token' });
        const session = await sessionService.validateAccess(bearer);
        if (!session) return status(401, { error: true, message: 'Session revoked' });
        const restrictedAllowed = path.endsWith('/mobile/auth/pin/change-required') || path.endsWith('/mobile/auth/logout') || path.endsWith('/mobile/auth/logout-all');
        if (session.restricted && !restrictedAllowed) return status(403, { error: true, message: 'يجب تغيير الرمز السري قبل المتابعة' });
        return { phrase: { _id: bearer._id, role: bearer.role, sid: bearer.sid, audience, mustChangePin: session.restricted } };
    });
}

/** A missing credential is guest access; any supplied credential is always validated. */
export const OptionalMobileAuthPlugin = new Elysia().derive({ as: 'scoped' }, async ({ headers, request, status }) => {
    const auth = headers.authorization;
    if (!auth || auth === 'null' || auth === 'undefined' || auth.length === 0) return { notificationViewer: { kind: 'guest' as const } };
    const bearer = verifyAccessToken(auth, TokenAudienceEnum.MOBILE);
    if (!bearer) return status(401, { error: true, message: 'Invalid token' });
    const session = await sessionService.validateAccess(bearer);
    if (!session) return status(401, { error: true, message: 'Session revoked' });
    const path = new URL(request.url).pathname;
    const restrictedAllowed = path.endsWith('/mobile/auth/pin/change-required') || path.endsWith('/mobile/auth/logout') || path.endsWith('/mobile/auth/logout-all');
    if (session.restricted && !restrictedAllowed) return status(403, { error: true, message: 'يجب تغيير الرمز السري قبل المتابعة' });
    if (bearer.role !== IUserRoleEnum.PATIENT) return status(403, { error: true, message: 'غير مصرح لك بالوصول' });
    return { notificationViewer: { kind: 'user' as const, userId: bearer._id } };
});
