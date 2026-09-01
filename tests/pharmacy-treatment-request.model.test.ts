import { describe, expect, test } from 'bun:test';
import { IUserRoleEnum } from '../src/interfaces/user.interface';
import { DASHBOARD_ROLES } from '../src/controller/dash/auth.controller';
import Pharmacy from '../src/models/pharmacy.model';
import TreatmentRequest from '../src/models/pharmacy-treatment-request.model';
import History from '../src/models/pharmacy-treatment-request-history.model';
import { PharmacyDispatchModeEnum, PharmacyDispatchStatusEnum, PharmacyPaymentMethodEnum, PharmacyRequestStatusEnum } from '../src/interfaces/pharmacy-treatment-request.interface';
import { SWAGGER_TAG_GROUPS, SWAGGER_TAGS } from '../src/constants/swagger-tags';
import { PHARMACY_WORKFLOW_RULES, PharmacyWorkflowOperationEnum as Op } from '../src/services/pharmacy-treatment-request.workflow';
import { supportsPharmacyTransactions } from '../src/services/pharmacy-transaction.service';

describe('Pharmacy identity, persistence, and documentation', () => {
    test('adds Pharmacy to the existing dashboard identity flow', () => {
        expect(IUserRoleEnum.PHARMACY).toBe('pharmacy');
        expect(DASHBOARD_ROLES).toContain('pharmacy');
    });
    test('defines request, dispatch, and payment states', () => {
        expect(Object.values(PharmacyRequestStatusEnum)).toEqual(['open','under_review','waiting_customer_approval','confirmed','preparing','ready_for_delivery','out_for_delivery','delivered','cancelled','rejected']);
        expect(Object.values(PharmacyDispatchStatusEnum)).toEqual(['OPEN','CLAIMED','CLOSED']);
        expect(Object.values(PharmacyDispatchModeEnum)).toEqual(['OPEN_POOL','ADMIN_DIRECT','ADMIN_REASSIGN']);
        expect(Object.values(PharmacyPaymentMethodEnum)).toEqual(['cash_on_delivery','card']);
    });
    test('defines one authoritative actor-scoped workflow and request-wide version', () => {
        expect(TreatmentRequest.schema.path('workflowVersion')).toBeDefined();
        expect(TreatmentRequest.schema.path('accepted_quotation')).toBeDefined();
        expect(PHARMACY_WORKFLOW_RULES[Op.ACCEPT_QUOTE]).toMatchObject({actor:'PATIENT',from:['waiting_customer_approval'],to:'confirmed'});
        expect(PHARMACY_WORKFLOW_RULES[Op.REJECT_QUOTE]).toMatchObject({actor:'PATIENT',to:'open'});
        expect(PHARMACY_WORKFLOW_RULES[Op.REASSIGN].from).not.toContain('confirmed');
    });
    test('accepts replica-set and mongos topology but rejects standalone MongoDB', () => {
        expect(supportsPharmacyTransactions({setName:'rs0'})).toBe(true);
        expect(supportsPharmacyTransactions({msg:'isdbgrid'})).toBe(true);
        expect(supportsPharmacyTransactions({})).toBe(false);
        expect(supportsPharmacyTransactions({setName:''})).toBe(false);
    });
    test('defines practical Pharmacy, pool, ownership, patient, and history indexes', () => {
        expect(Pharmacy.schema.indexes().some(([keys, options]) => keys.user_id === 1 && options.unique === true)).toBe(true);
        expect(Pharmacy.schema.indexes().some(([keys]) => keys.status === 1 && keys.accepts_prescription_requests === 1)).toBe(true);
        const indexes = TreatmentRequest.schema.indexes();
        expect(indexes.some(([keys]) => keys.patient_id === 1 && keys.createdAt === -1)).toBe(true);
        expect(indexes.some(([keys]) => keys['dispatch.status'] === 1 && keys.status === 1 && keys.createdAt === 1)).toBe(true);
        expect(indexes.some(([keys]) => keys['dispatch.pharmacy_id'] === 1 && keys.status === 1 && keys.createdAt === -1)).toBe(true);
        expect(History.schema.indexes().some(([keys]) => keys.request_id === 1 && keys.createdAt === 1)).toBe(true);
        expect(History.schema.path('updatedAt')).toBeUndefined();
    });
    test('adds Pharmacy navigation while retaining existing role groups', () => {
        const groups = new Map(SWAGGER_TAG_GROUPS.map(group => [group.name, group.tags]));
        expect(groups.get('Pharmacy')).toEqual([SWAGGER_TAGS.PHARMACY.PROFILE, SWAGGER_TAGS.PHARMACY.REQUESTS]);
        expect(groups.get('Admin')).toEqual(expect.arrayContaining([SWAGGER_TAGS.ADMIN.PHARMACIES, SWAGGER_TAGS.ADMIN.PHARMACY_REQUESTS]));
        expect(groups.get('Mobile')).toContain(SWAGGER_TAGS.MOBILE.PHARMACY_REQUESTS);
        expect(groups.has('Nurse')).toBe(true); expect(groups.has('Doctor')).toBe(true);
    });
});
