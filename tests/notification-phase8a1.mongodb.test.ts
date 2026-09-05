import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import mongoose from 'mongoose';
import Notification from '../src/models/notifications.model';
import NotificationRecipient from '../src/models/notification-recipient.model';
import NotificationRead from '../src/models/notification-read.model';
import notificationService from '../src/services/notification.service';
import { INotificationCategoryEnum, INotificationPrivacyEnum, INotificationTypeEnum } from '../src/interfaces/notification.interface';

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
});
