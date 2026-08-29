import Elysia from 'elysia';

/** Keeps framework-level errors aligned with the reusable Swagger response contracts. */
export const ApiErrorPlugin = new Elysia({ name: 'api-error-plugin' })
    .onError({ as: 'global' }, ({ code, set }) => {
        if (code === 'PARSE') {
            set.status = 400;
            return {
                error: true,
                message: 'صيغة البيانات المرسلة غير صحيحة',
            };
        }
        if (code === 'NOT_FOUND') {
            set.status = 404;
            return {
                error: true,
                message: 'المسار غير موجود',
            };
        }
        if (code === 'UNKNOWN' || code === 'INTERNAL_SERVER_ERROR') {
            set.status = 500;
            return {
                error: true,
                message: 'حدث خطأ في الخادم',
            };
        }
    });

