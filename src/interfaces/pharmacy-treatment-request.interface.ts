import type mongoose from 'mongoose'; import type { IBaseDocument } from './common.interface';
export const PharmacyRequestStatusEnum = { OPEN:'open', UNDER_REVIEW:'under_review', WAITING_CUSTOMER_APPROVAL:'waiting_customer_approval', CONFIRMED:'confirmed', PREPARING:'preparing', READY_FOR_DELIVERY:'ready_for_delivery', OUT_FOR_DELIVERY:'out_for_delivery', DELIVERED:'delivered', CANCELLED:'cancelled', REJECTED:'rejected' } as const;
export type PharmacyRequestStatus=(typeof PharmacyRequestStatusEnum)[keyof typeof PharmacyRequestStatusEnum];
export const PharmacyPaymentMethodEnum={ CASH_ON_DELIVERY:'cash_on_delivery', CARD:'card' } as const;
export type PharmacyPaymentMethod=(typeof PharmacyPaymentMethodEnum)[keyof typeof PharmacyPaymentMethodEnum];
export const PharmacyDispatchStatusEnum={ OPEN:'OPEN', CLAIMED:'CLAIMED', CLOSED:'CLOSED' } as const;
export const PharmacyDispatchModeEnum={ OPEN_POOL:'OPEN_POOL', ADMIN_DIRECT:'ADMIN_DIRECT', ADMIN_REASSIGN:'ADMIN_REASSIGN' } as const;
export interface PharmacyQuotationItem { name:string; quantity:number; unit_price:number; line_total:number; note?:string|null }
export interface PharmacyQuotation { version:number; pharmacy_id:mongoose.Types.ObjectId; items:PharmacyQuotationItem[]; unavailable_items:{name:string;note?:string|null}[]; medicines_subtotal:number; delivery_fee:number; discount:number; total_price:number; pharmacy_note?:string|null; quoted_at:Date; accepted_at?:Date|null }
export interface AcceptedPharmacyQuotation extends Omit<PharmacyQuotation, 'accepted_at'> { accepted_at:Date }
export interface IPharmacyTreatmentRequest extends IBaseDocument {
 request_number:string; patient_id:mongoose.Types.ObjectId; child_id?:mongoose.Types.ObjectId|null; prescription_images:string[]; treatment_details?:string|null;
 delivery_address:{address_text:string;lat:number;lng:number}; delivery_phone:string; notes?:string|null; preferred_payment_method:PharmacyPaymentMethod; status:PharmacyRequestStatus;
 workflowVersion:number; dispatch:{status:string;mode:string;pharmacy_id?:mongoose.Types.ObjectId|null;assigned_at?:Date|null;assigned_by_user_id?:mongoose.Types.ObjectId|null;version:number}; quotation?:PharmacyQuotation|null; accepted_quotation?:AcceptedPharmacyQuotation|null;
 excluded_pharmacy_ids:mongoose.Types.ObjectId[]; cancelled_at?:Date|null; cancelled_by_user_id?:mongoose.Types.ObjectId|null; cancellation_actor_type?:'PATIENT'|'ADMIN'|null; cancellation_reason?:string|null;
}
