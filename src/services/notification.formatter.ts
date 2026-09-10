import type mongoose from 'mongoose';
import type {
    INotificationCategory,
    INotificationPrivacy,
    INotificationType,
} from '../interfaces/notification.interface';

export type MobileNotificationTargetType =
    | 'appointment'
    | 'home_care_request'
    | 'pharmacy_treatment_request'
    | 'medication_dose';

export interface MobileNotificationDTO {
    _id: string;
    category?: INotificationCategory;
    type: INotificationType;
    title: string;
    body: string;
    target?: { type: MobileNotificationTargetType; id: string } | null;
    privacy?: INotificationPrivacy;
    createdAt: string;
    is_read: boolean;
    read_at: string | null;
}

export interface MobileNotificationSource {
    _id: mongoose.Types.ObjectId | string | { toString(): string };
    category?: INotificationCategory | null;
    type: INotificationType;
    title: string;
    body: string;
    target?: {
        type: MobileNotificationTargetType;
        id: mongoose.Types.ObjectId | string | { toString(): string };
    } | null;
    privacy?: INotificationPrivacy | null;
    createdAt: Date | string;
    is_read?: boolean | null;
    read_at?: Date | string | null;
}

function requiredString(value: unknown, field: string): string {
    if (value === null || value === undefined) throw new Error(`Mobile notification ${field} is required`);
    return String(value);
}

function isoDate(value: Date | string, field: string): string {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error(`Mobile notification ${field} is invalid`);
    return date.toISOString();
}

/** Converts Mongo/Mongoose notification values into the strict public Mobile DTO. */
export function formatMobileNotification(notification: MobileNotificationSource): MobileNotificationDTO {
    const dto: MobileNotificationDTO = {
        _id: requiredString(notification._id, '_id'),
        type: notification.type,
        title: notification.title,
        body: notification.body,
        createdAt: isoDate(notification.createdAt, 'createdAt'),
        is_read: notification.is_read === true,
        read_at: notification.read_at == null ? null : isoDate(notification.read_at, 'read_at'),
    };

    if (notification.category != null) dto.category = notification.category;
    if (notification.privacy != null) dto.privacy = notification.privacy;
    if (notification.target === null) {
        dto.target = null;
    } else if (notification.target !== undefined) {
        dto.target = {
            type: notification.target.type,
            id: requiredString(notification.target.id, 'target.id'),
        };
    }

    return dto;
}
