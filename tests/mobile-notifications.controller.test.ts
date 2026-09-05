import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import Elysia from 'elysia';
import { mobileNotificationsController } from '../src/controller/mobile/notifications.controller';
import notificationService from '../src/services/notification.service';
import sessionService from '../src/services/session.service';
import { signAccessToken } from '../src/constants/jwt';
import { TokenAudienceEnum } from '../src/constants/jwt';
import { IUserRoleEnum } from '../src/interfaces/user.interface';

process.env.ACCESS_TOKEN_SECRET = 'phase8a1-mobile-notification-access-secret';
const app = new Elysia({ prefix: '/api/mobile' }).use(mobileNotificationsController);
const installation = 'c0a80101-1234-4abc-8def-123456789abc';

describe('optional mobile notification auth', () => {
    afterEach(() => mock.restore());
    test('guest requires a valid installation id and a presented invalid token is never guest', async () => {
        expect((await app.handle(new Request('http://localhost/api/mobile/notifications'))).status).toBe(400);
        expect((await app.handle(new Request('http://localhost/api/mobile/notifications', { headers: { 'x-installation-id': 'not-a-uuid' } }))).status).toBe(400);
        expect((await app.handle(new Request('http://localhost/api/mobile/notifications', { headers: { authorization: 'Bearer broken', 'x-installation-id': installation } }))).status).toBe(401);
    });
    test('guest invokes the public viewer and valid patient auth does not need installation id', async () => {
        const inbox = spyOn(notificationService, 'getMobileInbox').mockResolvedValue({ data: [], total: 0, unread_count: 0 });
        const guest = await app.handle(new Request('http://localhost/api/mobile/notifications', { headers: { 'x-installation-id': installation } }));
        expect(guest.status).toBe(200); expect(inbox).toHaveBeenCalledWith(expect.objectContaining({ installationHash: expect.any(String) }), expect.anything());
        spyOn(sessionService, 'validateAccess').mockResolvedValue({ restricted: false } as never);
        const token = signAccessToken({ _id: '0123456789abcdef01234567', role: IUserRoleEnum.PATIENT, sid: 'a'.repeat(20), audience: TokenAudienceEnum.MOBILE });
        const patient = await app.handle(new Request('http://localhost/api/mobile/notifications', { headers: { authorization: `Bearer ${token}` } }));
        expect(patient.status).toBe(200); expect(inbox).toHaveBeenLastCalledWith({ userId: '0123456789abcdef01234567' }, expect.anything());
    });
});
