import { describe, expect, test } from 'bun:test';
import { Value } from '@sinclair/typebox/value';
import {
    MobileNotificationInboxResponseSchema,
    MobileNotificationReadAllResponseSchema,
    MobileNotificationReadResponseSchema,
    MobileNotificationSchema,
    MobileNotificationUnreadCountResponseSchema,
} from '../src/schemas/notification-response.schema';
import mongoose from 'mongoose';
import { formatMobileNotification } from '../src/services/notification.formatter';

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
    test('rejects raw BSON aggregation values and accepts the explicitly formatted DTO', () => {
        const raw = {
            _id: new mongoose.Types.ObjectId('65761473c0af5ea3a3eacf86'),
            category: 'appointments' as const,
            type: 'appointment_confirmed' as const,
            title: 'تم تأكيد الموعد',
            body: 'تم تأكيد موعدك',
            target: { type: 'appointment' as const, id: new mongoose.Types.ObjectId() },
            privacy: 'normal' as const,
            createdAt: new Date('2026-09-05T08:00:00.000Z'),
            is_read: false,
            read_at: null,
        };
        const envelope = (data: unknown[]) => ({
            error: false,
            message: 'تم جلب الإشعارات بنجاح',
            data,
            pagination: { ...pagination, total: 1 },
            unread_count: 1,
        });

        expect(Value.Check(MobileNotificationInboxResponseSchema, envelope([raw]))).toBe(false);
        const formatted = formatMobileNotification(raw);
        expect(formatted._id).toBe('65761473c0af5ea3a3eacf86');
        expect(typeof formatted.target?.id).toBe('string');
        expect(formatted.createdAt).toBe('2026-09-05T08:00:00.000Z');
        expect(formatted.read_at).toBeNull();
        expect(Value.Check(MobileNotificationInboxResponseSchema, envelope([formatted]))).toBe(true);
    });

    test('normalizes every supported target and both read states', () => {
        const targetTypes = ['appointment', 'home_care_request', 'pharmacy_treatment_request', 'medication_dose'] as const;
        for (const targetType of targetTypes) {
            const formatted = formatMobileNotification({
                _id: new mongoose.Types.ObjectId(),
                type: 'general',
                title: 'title',
                body: 'body',
                target: { type: targetType, id: new mongoose.Types.ObjectId() },
                createdAt: new Date('2026-09-05T08:00:00.000Z'),
                is_read: true,
                read_at: new Date('2026-09-05T09:00:00.000Z'),
            });
            expect(typeof formatted.target?.id).toBe('string');
            expect(formatted.is_read).toBe(true);
            expect(formatted.read_at).toBe('2026-09-05T09:00:00.000Z');
        }
    });

    test('preserves nullable and optional legacy semantics without fabricating fields', () => {
        const base = {
            _id: new mongoose.Types.ObjectId(),
            type: 'general' as const,
            title: 'legacy',
            body: 'legacy body',
            createdAt: '2026-09-05T08:00:00.000Z',
        };
        const absent = formatMobileNotification(base);
        expect(absent).not.toHaveProperty('category');
        expect(absent).not.toHaveProperty('privacy');
        expect(absent).not.toHaveProperty('target');
        expect(absent).toMatchObject({ is_read: false, read_at: null });

        const nullable = formatMobileNotification({ ...base, target: null, read_at: undefined });
        expect(nullable.target).toBeNull();
        expect(nullable.read_at).toBeNull();
        expect(Value.Check(MobileNotificationSchema, absent)).toBe(true);
        expect(Value.Check(MobileNotificationSchema, nullable)).toBe(true);
    });

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
