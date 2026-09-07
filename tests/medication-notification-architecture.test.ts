import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import mongoose from 'mongoose';
import Notification from '../src/models/notifications.model';
import NotificationRecipient from '../src/models/notification-recipient.model';
import notificationDeliveryService from '../src/services/notification-delivery.service';
import { DomainNotificationService } from '../src/services/domain-notification.service';

afterEach(() => mock.restore());

describe('Medication in-app-only notification boundary', () => {
    test('inAppOnly creates Notification and Recipient but never enqueues push delivery', async () => {
        const notification = { _id: new mongoose.Types.ObjectId(), expires_at: new Date(Date.now() + 1000) };
        const create = spyOn(Notification, 'create').mockResolvedValue([notification] as never);
        const recipients = spyOn(NotificationRecipient, 'insertMany').mockResolvedValue([] as never);
        const enqueue = spyOn(notificationDeliveryService, 'enqueueForNotification').mockResolvedValue(1);
        await new DomainNotificationService().inAppOnly({ userIds: [new mongoose.Types.ObjectId()], dedupeKey: 'medication:test', payload: { type: 'medication_reminder', title: 'x', body: 'y' } });
        expect(create).toHaveBeenCalledTimes(1);
        expect(recipients).toHaveBeenCalledTimes(1);
        expect(enqueue).not.toHaveBeenCalled();
    });

    test('existing targeted path still enqueues push delivery', async () => {
        const notification = { _id: new mongoose.Types.ObjectId(), expires_at: new Date(Date.now() + 1000) };
        spyOn(Notification, 'create').mockResolvedValue([notification] as never);
        spyOn(NotificationRecipient, 'insertMany').mockResolvedValue([] as never);
        const enqueue = spyOn(notificationDeliveryService, 'enqueueForNotification').mockResolvedValue(1);
        await new DomainNotificationService().targeted({ userIds: [new mongoose.Types.ObjectId()], dedupeKey: 'appointment:test', payload: { type: 'appointment_reminder', title: 'x', body: 'y' } });
        expect(enqueue).toHaveBeenCalledTimes(1);
    });
});

