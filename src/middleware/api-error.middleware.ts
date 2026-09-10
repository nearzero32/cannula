import Elysia from 'elysia';
import { DomainError } from '../services/domain-error';
import { requestIdFor } from './http-security.middleware';

const VALIDATION_FALLBACK_MESSAGE = 'تعذر التحقق من أحد حقول الطلب';

type ValidationIssue = {
    summary?: unknown;
    message?: unknown;
};

/** Returns useful validation context without exposing the submitted payload or validator model. */
export function validationErrorMessage(error: unknown): string {
    try {
        const issues = (error as { all?: unknown }).all;
        if (!Array.isArray(issues)) return VALIDATION_FALLBACK_MESSAGE;

        for (const issue of issues as ValidationIssue[]) {
            const reason = typeof issue.summary === 'string'
                ? issue.summary
                : typeof issue.message === 'string'
                    ? issue.message
                    : null;
            if (reason?.trim()) return reason.trim().slice(0, 1000);
        }
    } catch {
        // Some third-party validators expose `all` through a getter that may fail.
    }

    return VALIDATION_FALLBACK_MESSAGE;
}

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
            return {
                error: true,
                message: 'بيانات الطلب غير صالحة',
                error_message: validationErrorMessage(error),
                requestId,
            };
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
