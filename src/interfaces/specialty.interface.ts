import type mongoose from 'mongoose';

export const ISpecialtyStatusEnum = {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
} as const;

export type ISpecialtyStatus = (typeof ISpecialtyStatusEnum)[keyof typeof ISpecialtyStatusEnum];

export interface ISpecialty {
    _id: string;
    name: string;
    description?: string | null;
    icon?: string | null;
    status: ISpecialtyStatus;
    sortOrder: number;
    createdBy?: mongoose.Types.ObjectId | null;
    createdAt: Date;
    updatedAt: Date;
}
