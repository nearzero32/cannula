import type mongoose from 'mongoose';
import type { IBaseDocument, IWithNotesInternal } from './common.interface';
export const IPharmacyStatusEnum = { ACTIVE: 'active', INACTIVE: 'inactive', SUSPENDED: 'suspended' } as const;
export type IPharmacyStatus = (typeof IPharmacyStatusEnum)[keyof typeof IPharmacyStatusEnum];
export interface IPharmacy extends IBaseDocument, IWithNotesInternal {
    user_id: mongoose.Types.ObjectId; name: string; display_name?: string | null; logo?: string | null; phone: string;
    license_number?: string | null; license_verified: boolean;
    address: { address_text: string; lat?: number | null; lng?: number | null };
    accepts_prescription_requests: boolean; status: IPharmacyStatus;
}
