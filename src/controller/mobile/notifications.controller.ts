import Elysia, { t } from 'elysia';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import notificationService, { type NotificationViewer } from '../../services/notification.service';
import securityRateLimitService from '../../services/security-rate-limit.service';
import { OptionalMobileAuthPlugin } from '../../middleware/auth.middleware';
import { DomainError } from '../../services/domain-error';
import { SWAGGER_TAGS } from '../../constants/swagger-tags';
import { INotificationCategoryEnum } from '../../interfaces/notification.interface';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function installationHash(value: string | undefined): string {
    const normalized = value?.trim().toLowerCase();
    if (!normalized || !UUID_V4.test(normalized)) throw new DomainError('X-Installation-Id غير صالح', 400, 'INVALID_INSTALLATION_ID');
    return crypto.createHash('sha256').update(normalized).digest('hex');
}
function viewer(context: any): NotificationViewer {
    return context.notificationViewer.kind === 'user' ? { userId: context.notificationViewer.userId } : { installationHash: installationHash(context.headers['x-installation-id']) };
}
async function guestWriteLimit(context: any, value: NotificationViewer) {
    if ('userId' in value) return;
    const ip = context.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    await securityRateLimitService.enforce('NOTIFICATION_GUEST_WRITE', `${value.installationHash}:${ip}`, 'NOTIFICATION_GUEST_RATE_LIMITED');
}
const categories = [t.Literal('all'), ...Object.values(INotificationCategoryEnum).map((value) => t.Literal(value))];

export const mobileNotificationsController = new Elysia({ prefix: '/notifications', detail: { tags: [SWAGGER_TAGS.MOBILE.NOTIFICATIONS] } })
    .use(OptionalMobileAuthPlugin)
    .onError(({ error, set }) => { if (error instanceof DomainError) { set.status = error.status; return { error: true, message: error.message, code: error.code }; } })
    .get('/', async (context: any) => {
        const page = Math.max(1, Number(context.query.page) || 1), limit = Math.min(50, Math.max(1, Number(context.query.limit) || 20));
        const value = viewer(context), result = await notificationService.getMobileInbox(value, { page, limit, category: context.query.category });
        const pages = Math.ceil(result.total / limit);
        return { error: false, message: 'تم جلب الإشعارات بنجاح', data: result.data, pagination: { page, limit, total: result.total, pages, hasNext: page < pages, hasPrev: page > 1 }, unread_count: result.unread_count };
    }, { detail: { summary: 'Mobile inbox (optional auth)', description: 'No Authorization returns visible PUBLIC notifications and requires X-Installation-Id. A valid Patient mobile token returns PUBLIC plus that User’s TARGETED notifications. Presented invalid authorization returns 401. `all` only removes category filtering. is_read is computed; no UI icon or color fields are returned.' }, query: t.Object({ page: t.Optional(t.String()), limit: t.Optional(t.String()), category: t.Optional(t.Union(categories as any)) }), response: { 200: t.Any(), 400: t.Any(), 401: t.Any(), 403: t.Any(), 429: t.Any(), 500: t.Any() } })
    .get('/unread-count', async (context: any) => ({ error: false, data: { unread_count: await notificationService.unreadCount(viewer(context)) } }), { detail: { summary: 'Unread notification count', description: 'Optional auth; count covers every visible category.' }, response: { 200: t.Any(), 400: t.Any(), 401: t.Any(), 403: t.Any(), 429: t.Any(), 500: t.Any() } })
    .patch('/read-all', async (context: any) => { const value = viewer(context); await guestWriteLimit(context, value); const marked_count = await notificationService.markAllRead(value); return { error: false, message: 'تم تعليم الإشعارات كمقروءة', data: { marked_count, unread_count: await notificationService.unreadCount(value) } }; }, { detail: { summary: 'Mark all visible notifications read', description: 'Guest writes only PUBLIC receipts. A Patient writes PUBLIC plus own TARGETED receipts.' }, response: { 200: t.Any(), 400: t.Any(), 401: t.Any(), 403: t.Any(), 429: t.Any(), 500: t.Any() } })
    .patch('/:id/read', async (context: any) => { const value = viewer(context); await guestWriteLimit(context, value); if (!mongoose.Types.ObjectId.isValid(context.params.id) || !await notificationService.markRead(value, context.params.id)) { context.set.status = 404; return { error: true, message: 'الإشعار غير موجود' }; } return { error: false, message: 'تم تعليم الإشعار كمقروء', data: { unread_count: await notificationService.unreadCount(value) } }; }, { detail: { summary: 'Mark one notification read', description: 'Idempotent. Invisible or another user’s targeted ID returns 404.' }, params: t.Object({ id: t.String() }), response: { 200: t.Any(), 400: t.Any(), 401: t.Any(), 403: t.Any(), 404: t.Any(), 429: t.Any(), 500: t.Any() } });
