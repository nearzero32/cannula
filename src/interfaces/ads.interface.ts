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
    status: IAdsStatus;
    sort_order: number;
    start_date: Date | null;
    end_date: Date | null;
}
