import { t } from 'elysia';
import {
    INotificationCategoryEnum,
    INotificationPrivacyEnum,
    INotificationTypeEnum,
} from '../interfaces/notification.interface';
import { PaginationSchema } from './api-response.schema';

const NotificationTargetSchema = t.Object({
    type: t.Union([
        t.Literal('appointment'),
        t.Literal('home_care_request'),
        t.Literal('pharmacy_treatment_request'),
        t.Literal('medication_dose'),
    ]),
    id: t.String(),
}, { additionalProperties: false });

export const MobileNotificationSchema = t.Object({
    _id: t.String(),
    category: t.Optional(t.Enum(INotificationCategoryEnum)),
    type: t.Enum(INotificationTypeEnum),
    title: t.String(),
    body: t.String(),
    target: t.Optional(t.Nullable(NotificationTargetSchema)),
    privacy: t.Optional(t.Enum(INotificationPrivacyEnum)),
    createdAt: t.String({ format: 'date-time' }),
    is_read: t.Boolean(),
    read_at: t.Nullable(t.String({ format: 'date-time' })),
}, { additionalProperties: false });

export const MobileNotificationInboxResponseSchema = t.Object({
    error: t.Literal(false),
    message: t.String(),
    data: t.Array(MobileNotificationSchema),
    pagination: PaginationSchema,
    unread_count: t.Integer({ minimum: 0 }),
}, { additionalProperties: false });

export const MobileNotificationUnreadCountResponseSchema = t.Object({
    error: t.Literal(false),
    data: t.Object({
        unread_count: t.Integer({ minimum: 0 }),
    }, { additionalProperties: false }),
}, { additionalProperties: false });

export const MobileNotificationReadAllResponseSchema = t.Object({
    error: t.Literal(false),
    message: t.String(),
    data: t.Object({
        marked_count: t.Integer({ minimum: 0 }),
        unread_count: t.Integer({ minimum: 0 }),
    }, { additionalProperties: false }),
}, { additionalProperties: false });

export const MobileNotificationReadResponseSchema = t.Object({
    error: t.Literal(false),
    message: t.String(),
    data: t.Object({
        unread_count: t.Integer({ minimum: 0 }),
    }, { additionalProperties: false }),
}, { additionalProperties: false });
