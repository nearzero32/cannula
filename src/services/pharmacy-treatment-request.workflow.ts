import { PharmacyRequestStatusEnum as S, type PharmacyRequestStatus } from '../interfaces/pharmacy-treatment-request.interface';
import { DomainError } from './domain-error';

export const PharmacyWorkflowActorEnum = {
    PATIENT: 'PATIENT', PHARMACY: 'PHARMACY', ADMIN: 'ADMIN',
} as const;
export type PharmacyWorkflowActor = (typeof PharmacyWorkflowActorEnum)[keyof typeof PharmacyWorkflowActorEnum];

export const PharmacyWorkflowOperationEnum = {
    CLAIM: 'CLAIM', ASSIGN: 'ASSIGN', REASSIGN: 'REASSIGN', UNASSIGN: 'UNASSIGN',
    QUOTE: 'QUOTE', REVISE_QUOTE: 'REVISE_QUOTE', ACCEPT_QUOTE: 'ACCEPT_QUOTE', REJECT_QUOTE: 'REJECT_QUOTE',
    PATIENT_CANCEL: 'PATIENT_CANCEL', ADMIN_CANCEL: 'ADMIN_CANCEL', REOPEN: 'REOPEN',
    START_PREPARING: 'START_PREPARING', MARK_READY: 'MARK_READY', START_DELIVERY: 'START_DELIVERY', DELIVER: 'DELIVER',
} as const;
export type PharmacyWorkflowOperation = (typeof PharmacyWorkflowOperationEnum)[keyof typeof PharmacyWorkflowOperationEnum];

type Rule = { actor: PharmacyWorkflowActor; from: readonly PharmacyRequestStatus[]; to: PharmacyRequestStatus };
export const PHARMACY_WORKFLOW_RULES: Record<PharmacyWorkflowOperation, Rule> = {
    CLAIM: { actor: 'PHARMACY', from: [S.OPEN], to: S.UNDER_REVIEW },
    ASSIGN: { actor: 'ADMIN', from: [S.OPEN], to: S.UNDER_REVIEW },
    REASSIGN: { actor: 'ADMIN', from: [S.UNDER_REVIEW, S.WAITING_CUSTOMER_APPROVAL], to: S.UNDER_REVIEW },
    UNASSIGN: { actor: 'ADMIN', from: [S.UNDER_REVIEW, S.WAITING_CUSTOMER_APPROVAL], to: S.OPEN },
    QUOTE: { actor: 'PHARMACY', from: [S.UNDER_REVIEW], to: S.WAITING_CUSTOMER_APPROVAL },
    REVISE_QUOTE: { actor: 'PHARMACY', from: [S.WAITING_CUSTOMER_APPROVAL], to: S.WAITING_CUSTOMER_APPROVAL },
    ACCEPT_QUOTE: { actor: 'PATIENT', from: [S.WAITING_CUSTOMER_APPROVAL], to: S.CONFIRMED },
    REJECT_QUOTE: { actor: 'PATIENT', from: [S.WAITING_CUSTOMER_APPROVAL], to: S.OPEN },
    PATIENT_CANCEL: { actor: 'PATIENT', from: [S.OPEN, S.UNDER_REVIEW, S.WAITING_CUSTOMER_APPROVAL], to: S.CANCELLED },
    ADMIN_CANCEL: { actor: 'ADMIN', from: [S.OPEN, S.UNDER_REVIEW, S.WAITING_CUSTOMER_APPROVAL], to: S.CANCELLED },
    REOPEN: { actor: 'ADMIN', from: [S.CANCELLED, S.REJECTED], to: S.OPEN },
    START_PREPARING: { actor: 'PHARMACY', from: [S.CONFIRMED], to: S.PREPARING },
    MARK_READY: { actor: 'PHARMACY', from: [S.PREPARING], to: S.READY_FOR_DELIVERY },
    START_DELIVERY: { actor: 'PHARMACY', from: [S.READY_FOR_DELIVERY], to: S.OUT_FOR_DELIVERY },
    DELIVER: { actor: 'PHARMACY', from: [S.OUT_FOR_DELIVERY], to: S.DELIVERED },
};

export const PharmacyHistoryEventEnum = {
    CREATED: 'REQUEST_CREATED', CLAIMED: 'CLAIMED_BY_PHARMACY', ASSIGNED: 'ASSIGNED_BY_ADMIN',
    REASSIGNED: 'REASSIGNED_BY_ADMIN', UNASSIGNED: 'UNASSIGNED_BY_ADMIN',
    QUOTATION_CREATED: 'QUOTE_SUBMITTED', QUOTATION_REVISED: 'QUOTE_REVISED',
    QUOTATION_ACCEPTED: 'QUOTE_ACCEPTED_BY_CUSTOMER', QUOTATION_REJECTED: 'QUOTE_REJECTED_BY_CUSTOMER',
    CANCELLED: 'REQUEST_CANCELLED', REOPENED: 'REQUEST_REOPENED', STATUS_CHANGED: 'STATUS_CHANGED', DELIVERED: 'DELIVERED',
} as const;

export function assertPharmacyTransition(operation: PharmacyWorkflowOperation, actor: PharmacyWorkflowActor, from: PharmacyRequestStatus) {
    const rule = PHARMACY_WORKFLOW_RULES[operation];
    if (rule.actor !== actor || !rule.from.includes(from)) {
        throw new DomainError('لا يمكن تنفيذ هذا الإجراء في حالة الطلب الحالية', 409, 'INVALID_STATE_TRANSITION');
    }
    return rule.to;
}
