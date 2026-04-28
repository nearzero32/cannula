import type mongoose from 'mongoose';

export const ISecretaryPermissionEnum = {
    VIEW_SCHEDULE: 'view_schedule',
    CREATE_APPOINTMENT: 'create_appointment',
    EDIT_APPOINTMENT: 'edit_appointment',
    CANCEL_APPOINTMENT: 'cancel_appointment',
    VIEW_PATIENTS: 'view_patients',
    EDIT_PATIENTS_BASIC: 'edit_patients_basic',
    CHECK_IN_PATIENTS: 'check_in_patients',
    MANAGE_WAITING_QUEUE: 'manage_waiting_queue',
    SEND_REMINDERS: 'send_reminders',
} as const;

export type ISecretaryPermission = (typeof ISecretaryPermissionEnum)[keyof typeof ISecretaryPermissionEnum];

export const ISecretaryStatusEnum = {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
    SUSPENDED: 'suspended',
} as const;

export type ISecretaryStatus = (typeof ISecretaryStatusEnum)[keyof typeof ISecretaryStatusEnum];

/** Default permission set when creating a secretary (matches schema defaults). */
export const ISecretaryDefaultPermissions: ISecretaryPermission[] = [
    ISecretaryPermissionEnum.VIEW_SCHEDULE,
    ISecretaryPermissionEnum.CREATE_APPOINTMENT,
    ISecretaryPermissionEnum.EDIT_APPOINTMENT,
    ISecretaryPermissionEnum.CANCEL_APPOINTMENT,
    ISecretaryPermissionEnum.VIEW_PATIENTS,
    ISecretaryPermissionEnum.CHECK_IN_PATIENTS,
];

export interface ISecretary {
    _id: string;
    user_id: mongoose.Types.ObjectId;
    full_name: string;
    clinic_id?: mongoose.Types.ObjectId;
    doctor_ids: mongoose.Types.ObjectId[];
    permissions: ISecretaryPermission[];
    status: ISecretaryStatus;
    created_by?: mongoose.Types.ObjectId | null;
    notes_internal?: string | null;
    createdAt: Date;
    updatedAt: Date;
}
