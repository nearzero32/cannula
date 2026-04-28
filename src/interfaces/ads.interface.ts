import mongoose from 'mongoose';
import type { ITimestamps } from './common.interface';

export const IAdsStatusEnum = {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
} as const;

export type IAdsStatus = (typeof IAdsStatusEnum)[keyof typeof IAdsStatusEnum];

export interface IAds extends ITimestamps {
    title: string | null;
    description: string | null;
    image: string;
    link: string | null;
    clinic_id: mongoose.Types.ObjectId;
    status: IAdsStatus;
    end_date: Date | null;
}
