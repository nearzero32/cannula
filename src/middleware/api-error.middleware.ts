import Elysia from 'elysia';
import { DomainError } from '../services/domain-error';
import { requestIdFor } from './http-security.middleware';

/** Keeps framework-level errors aligned with the reusable Swagger response contracts. */
export const ApiErrorPlugin = new Elysia({ name: 'api-error-plugin' })
    .onError({ as: 'global' }, ({ code, error, request, set }) => {
        const requestId = requestIdFor(request);
        set.headers['X-Request-Id'] = requestId;
        if (error instanceof DomainError) {
            set.status = error.status;
            return { error: true, message: error.message, ...(error.code ? { code: error.code } : {}), ...(error.details ? { details: error.details } : {}), requestId };
        }
        if (code === 'PARSE') {
            set.status = 400;
            return {
                error: true,
                message: 'صيغة البيانات المرسلة غير صحيحة',
                requestId,
            };
        }
        if (code === 'VALIDATION') {
            set.status = 422;
            return { error: true, message: 'بيانات الطلب غير صالحة', requestId };
        }
        if (code === 'NOT_FOUND') {
            set.status = 404;
            return {
                error: true,
                message: 'المسار غير موجود',
                requestId,
            };
        }
        if (code === 'UNKNOWN' || code === 'INTERNAL_SERVER_ERROR') {
            console.error(JSON.stringify({ level: 'error', requestId, code: 'INTERNAL_SERVER_ERROR', errorType: error instanceof Error ? error.name : 'unknown' }));
            set.status = 500;
            return {
                error: true,
                message: 'حدث خطأ في الخادم',
                code: 'INTERNAL_SERVER_ERROR',
                requestId,
            };
        }
    });
