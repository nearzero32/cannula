import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import mongoose from 'mongoose';
import Notification from '../src/models/notifications.model';
import NotificationRecipient from '../src/models/notification-recipient.model';
import NotificationRead from '../src/models/notification-read.model';
import notificationService from '../src/services/notification.service';
import { INotificationCategoryEnum, INotificationPrivacyEnum, INotificationTypeEnum } from '../src/interfaces/notification.interface';
import { NOTIFICATION_READ_ALL_BATCH_SIZE } from '../src/services/notification.service';

const uri = process.env.MONGODB_TEST_URI;
const enabled = Boolean(uri);
const run = enabled ? describe : describe.skip;

run('Phase 8A1 notification core against MongoDB', () => {
    const userA = new mongoose.Types.ObjectId(), userB = new mongoose.Types.ObjectId();
    const guestA = 'a'.repeat(64), guestB = 'b'.repeat(64);
    const input = (category: string = INotificationCategoryEnum.APPOINTMENTS) => ({ category: category as typeof INotificationCategoryEnum[keyof typeof INotificationCategoryEnum], type: INotificationTypeEnum.APPOINTMENT_CONFIRMED, title: 'عنوان', body: 'نص', privacy: INotificationPrivacyEnum.NORMAL });
    beforeAll(async () => {
        await mongoose.connect(uri!);
        await Promise.all([Notification.syncIndexes(), NotificationRecipient.syncIndexes(), NotificationRead.syncIndexes()]);
    });
    beforeEach(async () => { await mongoose.connection.dropDatabase(); await Promise.all([Notification.syncIndexes(), NotificationRecipient.syncIndexes(), NotificationRead.syncIndexes()]); });
    afterAll(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });

    test('stores semantic content with no visual configuration and public creates no recipient rows', async () => {
        const publicNotification = await notificationService.createPublic(input());
        const raw = await Notification.findById(publicNotification._id).lean().exec() as any;
        expect(raw.audience).toBe('public'); expect(raw.category).toBe('appointments'); expect(raw.privacy).toBe('normal');
        for (const field of ['icon', 'icon_name', 'icon_url', 'color', 'background_color', 'badge_color']) expect(raw).not.toHaveProperty(field);
        expect(await NotificationRecipient.countDocuments({ notification_id: publicNotification._id })).toBe(0);
    });

    test('visibility is public-only for guests and public plus own targeted for each user', async () => {
        const publicNotification = await notificationService.createPublic(input());
        const targetA = await notificationService.createTargeted(input(INotificationCategoryEnum.SERVICES), [userA]);
        const targetB = await notificationService.createTargeted(input(INotificationCategoryEnum.RESULTS), [userB]);
        const guest = await notificationService.getMobileInbox({ installationHash: guestA }, { page: 1, limit: 20 });
        const a = await notificationService.getMobileInbox({ userId: String(userA) }, { page: 1, limit: 20 });
        const b = await notificationService.getMobileInbox({ userId: String(userB) }, { page: 1, limit: 20 });
        expect(guest.data.map((x: any) => String(x._id))).toEqual([String(publicNotification._id)]);
        expect(a.data.map((x: any) => String(x._id))).toEqual(expect.arrayContaining([String(publicNotification._id), String(targetA._id)]));
        expect(a.data.map((x: any) => String(x._id))).not.toContain(String(targetB._id));
        expect(b.data.map((x: any) => String(x._id))).toEqual(expect.arrayContaining([String(publicNotification._id), String(targetB._id)]));
    });

    test('category filtering, global unread count, and read receipt identities are isolated', async () => {
        const publicNotification = await notificationService.createPublic(input(INotificationCategoryEnum.APPOINTMENTS));
        const serviceNotification = await notificationService.createPublic(input(INotificationCategoryEnum.SERVICES));
        const targeted = await notificationService.createTargeted(input(INotificationCategoryEnum.RESULTS), [userA]);
        const filtered = await notificationService.getMobileInbox({ userId: String(userA) }, { page: 1, limit: 20, category: 'appointments' });
        expect(filtered.data).toHaveLength(1); expect(String((filtered.data[0] as any)._id)).toBe(String(publicNotification._id));
        expect(await notificationService.unreadCount({ userId: String(userA) })).toBe(3);
        expect(await notificationService.markRead({ installationHash: guestA }, String(publicNotification._id))).toBe(true);
        expect(await notificationService.markRead({ installationHash: guestA }, String(publicNotification._id))).toBe(true);
        expect(await NotificationRead.countDocuments({ notification_id: publicNotification._id, installation_key_hash: guestA })).toBe(1);
        expect((await notificationService.getMobileInbox({ installationHash: guestA }, { page: 1, limit: 20 })).data.find((x: any) => String(x._id) === String(publicNotification._id))?.is_read).toBe(true);
        expect((await notificationService.getMobileInbox({ installationHash: guestB }, { page: 1, limit: 20 })).data.find((x: any) => String(x._id) === String(publicNotification._id))?.is_read).toBe(false);
        expect(await notificationService.markRead({ userId: String(userA) }, String(targeted._id))).toBe(true);
        expect(await notificationService.markRead({ userId: String(userB) }, String(targeted._id))).toBe(false);
        expect(await notificationService.unreadCount({ userId: String(userA) })).toBe(2);
        expect(serviceNotification).toBeDefined();
    });

    test('mark-all writes only visible notifications and recipient/read uniqueness is enforced', async () => {
        const publicNotification = await notificationService.createPublic(input());
        const targetA = await notificationService.createTargeted(input(), [userA]);
        const targetB = await notificationService.createTargeted(input(), [userB]);
        expect(await notificationService.markAllRead({ userId: String(userA) })).toBe(2);
        expect(await NotificationRead.countDocuments({ reader_type: 'user', user_id: userA })).toBe(2);
        expect(await NotificationRead.countDocuments({ notification_id: targetB._id, reader_type: 'user', user_id: userA })).toBe(0);
        await expect(NotificationRecipient.create({ notification_id: targetA._id, user_id: userA, expires_at: new Date(Date.now() + 86400000) })).rejects.toMatchObject({ code: 11000 });
        await expect(NotificationRead.create({ notification_id: publicNotification._id, reader_type: 'user', user_id: userA, expires_at: new Date(Date.now() + 86400000) })).rejects.toMatchObject({ code: 11000 });
    });

    test('large public feed is paginated in Mongo and read-all is cursor-batched and idempotent', async () => {
        const now = new Date();
        const count = NOTIFICATION_READ_ALL_BATCH_SIZE * 2 + 5;
        await Notification.insertMany(Array.from({ length: count }, (_, index) => ({
            audience: 'public', category: index % 2 ? 'services' : 'appointments', type: INotificationTypeEnum.APPOINTMENT_CONFIRMED,
            title: `n-${index}`, body: 'body', privacy: 'normal', recipient_ids: [], recipient_model: 'all', status: 'pending', is_read: false,
            visible_at: now, expires_at: new Date(now.getTime() + 86400000), createdAt: now, updatedAt: now,
        })));
        const page = await notificationService.getMobileInbox({ installationHash: guestA }, { page: 2, limit: 20, category: 'all' });
        expect(page.data).toHaveLength(20); expect(page.total).toBe(count); expect(page.unread_count).toBe(count);
        expect(await notificationService.markAllRead({ installationHash: guestA }, now)).toBe(count);
        expect(await NotificationRead.countDocuments({ reader_type: 'installation', installation_key_hash: guestA })).toBe(count);
        expect(await notificationService.markAllRead({ installationHash: guestA }, now)).toBe(0);
        expect(await notificationService.unreadCount({ installationHash: guestA })).toBe(0);
    });

    test('large authenticated union feed paginates categories and keeps viewer-specific read state', async () => {
        const now = new Date(), perAudience = 501;
        const docs = await Notification.insertMany(Array.from({ length: perAudience * 3 }, (_, index) => ({ audience: index < perAudience ? 'public' : 'targeted', category: index % 2 ? 'services' : 'appointments', type: INotificationTypeEnum.APPOINTMENT_CONFIRMED, title: `mix-${index}`, body: 'body', privacy: 'normal', recipient_ids: [], recipient_model: index < perAudience ? 'all' : 'User', status: 'pending', is_read: false, visible_at: now, expires_at: new Date(now.getTime() + 86400000), createdAt: new Date(now.getTime() + index), updatedAt: now })));
        await NotificationRecipient.insertMany([...docs.slice(perAudience, perAudience * 2).map((n) => ({ notification_id: n._id, user_id: userA, expires_at: n.expires_at })), ...docs.slice(perAudience * 2).map((n) => ({ notification_id: n._id, user_id: userB, expires_at: n.expires_at }))]);
        await notificationService.markRead({ userId: String(userA) }, String(docs[perAudience]!._id));
        await notificationService.markRead({ userId: String(userB) }, String(docs[perAudience]!._id));
        const page = await notificationService.getMobileInbox({ userId: String(userA) }, { page: 2, limit: 20 });
        expect(page.total).toBe(perAudience * 2); expect(page.data).toHaveLength(20);
        expect(page.data.every((n: any) => n.title.startsWith('mix-'))).toBe(true);
        expect(page.data.every((n: any) => n.category === 'appointments' || n.category === 'services')).toBe(true);
        const category = await notificationService.getMobileInbox({ userId: String(userA) }, { page: 2, limit: 20, category: 'services' });
        expect(category.data).toHaveLength(20); expect(category.data.every((n: any) => n.category === 'services')).toBe(true); expect(category.unread_count).toBe(page.unread_count);
    });

    test('large multi-viewer unread counts and injected read-all cutoff are exact', async () => {
        const now = new Date(), publicDocs = await Notification.insertMany(Array.from({ length: 300 }, (_, i) => ({ audience: 'public', category: i % 2 ? 'appointments' : 'services', type: INotificationTypeEnum.APPOINTMENT_CONFIRMED, title: `p${i}`, body: 'b', privacy: 'normal', recipient_ids: [], recipient_model: 'all', status: 'pending', is_read: false, visible_at: now, expires_at: new Date(now.getTime() + 86400000) })));
        const targets = await Notification.insertMany(Array.from({ length: 350 }, (_, i) => ({ audience: 'targeted', category: 'results', type: INotificationTypeEnum.APPOINTMENT_CONFIRMED, title: `t${i}`, body: 'b', privacy: 'normal', recipient_ids: [], recipient_model: 'User', status: 'pending', is_read: false, visible_at: now, expires_at: new Date(now.getTime() + 86400000) })));
        await NotificationRecipient.insertMany([...targets.slice(0, 200).map((n) => ({ notification_id: n._id, user_id: userA, expires_at: n.expires_at })), ...targets.slice(200).map((n) => ({ notification_id: n._id, user_id: userB, expires_at: n.expires_at }))]);
        for (const n of publicDocs.slice(0, 10)) await notificationService.markRead({ installationHash: guestA }, String(n._id));
        for (const n of publicDocs.slice(0, 20)) await notificationService.markRead({ installationHash: guestB }, String(n._id));
        for (const n of [...publicDocs.slice(0, 30), ...targets.slice(0, 40)]) await notificationService.markRead({ userId: String(userA) }, String(n._id));
        for (const n of [...publicDocs.slice(0, 50), ...targets.slice(200, 260)]) await notificationService.markRead({ userId: String(userB) }, String(n._id));
        expect(await notificationService.unreadCount({ installationHash: guestA })).toBe(290); expect(await notificationService.unreadCount({ installationHash: guestB })).toBe(280);
        expect(await notificationService.unreadCount({ userId: String(userA) })).toBe(430); expect(await notificationService.unreadCount({ userId: String(userB) })).toBe(340);
        await Promise.all([Notification.deleteMany({}), NotificationRecipient.deleteMany({}), NotificationRead.deleteMany({})]);
        const cutoff = new Date('2026-09-05T08:00:00.000Z');
        const cutoffDocs = await Notification.insertMany([{ audience: 'targeted', category: 'system', type: INotificationTypeEnum.GENERAL, title: 'n1', body: 'b', privacy: 'normal', recipient_ids: [], recipient_model: 'User', status: 'pending', is_read: false, visible_at: new Date('2026-09-05T07:00:00Z'), expires_at: new Date('2026-10-01'), createdAt: new Date('2026-09-05T07:00:00Z') }, { audience: 'targeted', category: 'system', type: INotificationTypeEnum.GENERAL, title: 'n2', body: 'b', privacy: 'normal', recipient_ids: [], recipient_model: 'User', status: 'pending', is_read: false, visible_at: new Date('2026-09-05T07:00:00Z'), expires_at: new Date('2026-10-01'), createdAt: cutoff }, { audience: 'targeted', category: 'system', type: INotificationTypeEnum.GENERAL, title: 'n3', body: 'b', privacy: 'normal', recipient_ids: [], recipient_model: 'User', status: 'pending', is_read: false, visible_at: new Date('2026-09-05T07:00:00Z'), expires_at: new Date('2026-10-01'), createdAt: new Date('2026-09-05T09:00:00Z') }, { audience: 'targeted', category: 'system', type: INotificationTypeEnum.GENERAL, title: 'n4', body: 'b', privacy: 'normal', recipient_ids: [], recipient_model: 'User', status: 'pending', is_read: false, visible_at: new Date('2026-09-05T09:00:00Z'), expires_at: new Date('2026-10-01'), createdAt: new Date('2026-09-05T07:00:00Z') }, { audience: 'targeted', category: 'system', type: INotificationTypeEnum.GENERAL, title: 'n5', body: 'b', privacy: 'normal', recipient_ids: [], recipient_model: 'User', status: 'pending', is_read: false, visible_at: new Date('2026-09-05T07:00:00Z'), expires_at: cutoff, createdAt: new Date('2026-09-05T07:00:00Z') }]);
        await NotificationRecipient.insertMany(cutoffDocs.map((n) => ({ notification_id: n._id, user_id: userA, expires_at: n.expires_at })));
        expect(await notificationService.markAllRead({ userId: String(userA) }, cutoff)).toBe(2); expect(await notificationService.markAllRead({ userId: String(userA) }, cutoff)).toBe(0);
        expect(await NotificationRead.countDocuments({ notification_id: { $in: cutoffDocs.map((n) => n._id) }, user_id: userA })).toBe(2);
    });
});
