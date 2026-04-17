import mongoose from 'mongoose';

export const IAdsStatusEnum = {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
} as const;

export type IAdsStatus = (typeof IAdsStatusEnum)[keyof typeof IAdsStatusEnum];

export interface IAds {
    title: string | null;
    description: string | null;
    image: string;
    link: string | null;
    clinicId: mongoose.Types.ObjectId;
    status: IAdsStatus;
    endDate: Date | null;
    createdAt: Date;
    updatedAt: Date;
}
