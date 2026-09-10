import { describe, expect, test } from 'bun:test';
import { Value } from '@sinclair/typebox/value';
import {
    MobileNotificationInboxResponseSchema,
    MobileNotificationReadAllResponseSchema,
    MobileNotificationReadResponseSchema,
    MobileNotificationUnreadCountResponseSchema,
} from '../src/schemas/notification-response.schema';

const pagination = { page: 1, limit: 20, total: 2, pages: 1, hasNext: false, hasPrev: false };
const publicNotification = {
    _id: '66f000000000000000000080',
    category: 'system',
    type: 'general',
    title: 'تنبيه عام',
    body: 'محتوى عام',
    target: null,
    privacy: 'normal',
    createdAt: '2026-09-05T08:00:00.000Z',
    is_read: false,
    read_at: null,
};
const targetedNotification = {
    ...publicNotification,
    _id: '66f000000000000000000081',
    category: 'appointments',
    type: 'appointment_confirmed',
    target: { type: 'appointment', id: '66f000000000000000000070' },
    privacy: 'sensitive',
    is_read: true,
    read_at: '2026-09-05T09:00:00.000Z',
};

describe('Mobile Notification response schemas', () => {
    test('accepts public and targeted items with viewer-specific read state and pagination', () => {
        expect(Value.Check(MobileNotificationInboxResponseSchema, {
            error: false,
            message: 'تم جلب الإشعارات بنجاح',
            data: [publicNotification, targetedNotification],
            pagination,
            unread_count: 1,
        })).toBe(true);
    });

    test('accurately permits nullable/legacy-optional projected fields', () => {
        const legacy = { ...publicNotification } as Record<string, unknown>;
        delete legacy.category;
        delete legacy.privacy;
        delete legacy.target;
        expect(Value.Check(MobileNotificationInboxResponseSchema, {
            error: false, message: 'ok', data: [legacy], pagination: { ...pagination, total: 1 }, unread_count: 1,
        })).toBe(true);
        expect(Value.Check(MobileNotificationInboxResponseSchema, {
            error: false, message: 'ok', data: [{ ...publicNotification, unexpected: true }], pagination, unread_count: 1,
        })).toBe(false);
    });

    test('models unread, read-all, and mark-one envelopes without inventing message fields', () => {
        expect(Value.Check(MobileNotificationUnreadCountResponseSchema, { error: false, data: { unread_count: 2 } })).toBe(true);
        expect(Value.Check(MobileNotificationUnreadCountResponseSchema, { error: false, message: 'extra', data: { unread_count: 2 } })).toBe(false);
        expect(Value.Check(MobileNotificationReadAllResponseSchema, { error: false, message: 'ok', data: { marked_count: 2, unread_count: 0 } })).toBe(true);
        expect(Value.Check(MobileNotificationReadResponseSchema, { error: false, message: 'ok', data: { unread_count: 0 } })).toBe(true);
    });
});
