import type mongoose from 'mongoose';
import type { IBaseDocument, IWithCreatedBy } from './common.interface';

export const IChronicConditionStatusEnum = {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
} as const;

export type IChronicConditionStatus =
    (typeof IChronicConditionStatusEnum)[keyof typeof IChronicConditionStatusEnum];

export interface IChronicCondition extends IBaseDocument, IWithCreatedBy {
    name: string;
    description?: string | null;
    status: IChronicConditionStatus;
}
