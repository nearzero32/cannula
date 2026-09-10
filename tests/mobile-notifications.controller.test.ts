import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import Elysia from 'elysia';
import { mobileNotificationsController } from '../src/controller/mobile/notifications.controller';
import notificationService from '../src/services/notification.service';
import sessionService from '../src/services/session.service';
import { signAccessToken } from '../src/constants/jwt';
import { TokenAudienceEnum } from '../src/constants/jwt';
import { IUserRoleEnum } from '../src/interfaces/user.interface';
import mongoose from 'mongoose';
import { formatMobileNotification } from '../src/services/notification.formatter';

process.env.ACCESS_TOKEN_SECRET = 'phase8a1-mobile-notification-access-secret';
const app = new Elysia({ prefix: '/api/mobile' }).use(mobileNotificationsController);
const installation = 'c0a80101-1234-4abc-8def-123456789abc';
const patientId = '0123456789abcdef01234567';
function patientToken() {
    return signAccessToken({ _id: patientId, role: IUserRoleEnum.PATIENT, sid: 'a'.repeat(20), audience: TokenAudienceEnum.MOBILE });
}

describe('optional mobile notification auth', () => {
    afterEach(() => mock.restore());
    test('guest requires a valid installation id and a presented invalid token is never guest', async () => {
        expect((await app.handle(new Request('http://localhost/api/mobile/notifications'))).status).toBe(400);
        expect((await app.handle(new Request('http://localhost/api/mobile/notifications', { headers: { 'x-installation-id': 'not-a-uuid' } }))).status).toBe(400);
        expect((await app.handle(new Request('http://localhost/api/mobile/notifications', { headers: { authorization: 'Bearer broken', 'x-installation-id': installation } }))).status).toBe(401);
    });
    test('guest invokes the public viewer and valid patient auth does not need installation id', async () => {
        const item = formatMobileNotification({
            _id: new mongoose.Types.ObjectId('65761473c0af5ea3a3eacf86'),
            category: 'system', type: 'general', title: 'تنبيه', body: 'نص', target: null,
            privacy: 'normal', createdAt: new Date('2026-09-05T08:00:00.000Z'), is_read: false, read_at: null,
        });
        const inbox = spyOn(notificationService, 'getMobileInbox').mockResolvedValue({ data: [item], total: 1, unread_count: 1 });
        const guest = await app.handle(new Request('http://localhost/api/mobile/notifications', { headers: { 'x-installation-id': installation } }));
        expect(guest.status).toBe(200); expect(inbox).toHaveBeenCalledWith(expect.objectContaining({ installationHash: expect.any(String) }), expect.anything());
        const guestBody = await guest.json() as any;
        expect(guestBody.data[0]).toMatchObject({ _id: '65761473c0af5ea3a3eacf86', createdAt: '2026-09-05T08:00:00.000Z', is_read: false, read_at: null });
        spyOn(sessionService, 'validateAccess').mockResolvedValue({ restricted: false } as never);
        const token = patientToken();
        const patient = await app.handle(new Request('http://localhost/api/mobile/notifications', { headers: { authorization: `Bearer ${token}` } }));
        expect(patient.status).toBe(200); expect(inbox).toHaveBeenLastCalledWith({ userId: patientId }, expect.anything());
        expect((await patient.json() as any).data[0]).toEqual(guestBody.data[0]);
    });

    test('unread-count, read-all, and mark-one return strict numeric envelopes', async () => {
        spyOn(sessionService, 'validateAccess').mockResolvedValue({ restricted: false } as never);
        const token = patientToken();
        const headers = { authorization: `Bearer ${token}` };
        const unread = spyOn(notificationService, 'unreadCount').mockResolvedValue(7);

        const countResponse = await app.handle(new Request('http://localhost/api/mobile/notifications/unread-count', { headers }));
        expect(countResponse.status).toBe(200);
        expect(await countResponse.json()).toEqual({ error: false, data: { unread_count: 7 } });

        spyOn(notificationService, 'markAllRead').mockResolvedValue(3);
        unread.mockResolvedValue(0);
        const allResponse = await app.handle(new Request('http://localhost/api/mobile/notifications/read-all', { method: 'PATCH', headers }));
        expect(allResponse.status).toBe(200);
        expect(await allResponse.json()).toMatchObject({ error: false, data: { marked_count: 3, unread_count: 0 } });

        spyOn(notificationService, 'markRead').mockResolvedValue(true);
        const oneResponse = await app.handle(new Request('http://localhost/api/mobile/notifications/65761473c0af5ea3a3eacf86/read', { method: 'PATCH', headers }));
        expect(oneResponse.status).toBe(200);
        expect(await oneResponse.json()).toMatchObject({ error: false, data: { unread_count: 0 } });
    });
});
