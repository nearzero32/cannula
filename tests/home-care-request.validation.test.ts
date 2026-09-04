import { describe, expect, test } from 'bun:test';
import mongoose from 'mongoose';
import { Value } from '@sinclair/typebox/value';
import {
    validateHomeCareRequestAddress,
    validatePreferredTime,
    validateRequestedDate,
} from '../src/services/home-care-request.validation';
import {
    assertHomeCareRequestTransition,
    HOME_CARE_REQUEST_TRANSITIONS,
} from '../src/services/home-care-request.service';
import { IHomeCareRequestStatusEnum } from '../src/interfaces/home-care-request.interface';
import HomeCareRequest from '../src/models/home-care-request.model';
import {
    formatHomeCareRequestForDashboard,
    formatHomeCareRequestForMobile,
} from '../src/services/home-care-request.formatter';
import {
    DashboardHomeCareRequestSchema,
    MobileHomeCareRequestSchema,
} from '../src/schemas/home-care-request-response.schema';

function requestFixture(child = false) {
    const now = new Date('2026-08-31T12:00:00.000Z');
    return {
        _id: new mongoose.Types.ObjectId('507f191e810c19729de860e1'),
        request_number: 'HC-2026-000123',
        patient_id: {
            _id: new mongoose.Types.ObjectId('507f191e810c19729de860e2'),
            full_name: 'مريض تجريبي',
            phone: '07700000000',
            profile_photo: null,
        },
        child_id: child ? {
            _id: new mongoose.Types.ObjectId('507f191e810c19729de860e3'),
            full_name: 'طفل تجريبي',
            date_of_birth: new Date('2020-01-01T00:00:00.000Z'),
        } : null,
        category_id: new mongoose.Types.ObjectId('507f191e810c19729de860e4'),
        service_id: new mongoose.Types.ObjectId('507f191e810c19729de860e5'),
        service_name: 'تمريض منزلي',
        service_price: 15000,
        service_duration_min: 30,
        service_duration_max: 60,
        requested_date: new Date('2026-09-02T00:00:00.000Z'),
        preferred_time: '09:00',
        address: { address_text: 'بغداد - المنصور', lat: 33.3152, lng: 44.3661 },
        notes: 'يرجى الاتصال قبل الوصول',
        status: IHomeCareRequestStatusEnum.PENDING,
        internal_notes: 'ملاحظة لا تظهر للمريض',
        cancelled_at: null,
        cancelled_by: null,
        cancellation_reason: null,
        createdAt: now,
        updatedAt: now,
    } as never;
}

describe('Home Care request validation', () => {
    const now = new Date('2026-08-31T15:00:00.000Z');

    test('normalizes a valid requested date and rejects past or impossible dates', () => {
        expect(validateRequestedDate('2026-09-02', now).toISOString()).toBe('2026-09-02T00:00:00.000Z');
        expect(() => validateRequestedDate('2026-08-30', now)).toThrow('تاريخ سابق');
        expect(() => validateRequestedDate('2026-02-30', now)).toThrow('غير صالح');
    });

    test('accepts strict HH:mm only', () => {
        expect(validatePreferredTime('09:00')).toBe('09:00');
        expect(() => validatePreferredTime('9:00')).toThrow('الوقت المفضل غير صالح');
        expect(() => validatePreferredTime('09:00 صباحاً')).toThrow('الوقت المفضل غير صالح');
        expect(() => validatePreferredTime('24:00')).toThrow('الوقت المفضل غير صالح');
    });

    test('normalizes addresses and rejects invalid coordinates', () => {
        expect(validateHomeCareRequestAddress({
            address_text: '  بغداد   - المنصور  ', lat: 33.3, lng: 44.3,
        }).address_text).toBe('بغداد - المنصور');
        expect(() => validateHomeCareRequestAddress({ address_text: 'بغداد', lat: 91, lng: 44 }))
            .toThrow('خط العرض');
        expect(() => validateHomeCareRequestAddress({ address_text: 'بغداد', lat: 33, lng: 181 }))
            .toThrow('خط الطول');
    });
});

describe('Home Care request lifecycle', () => {
    test('contains the explicit allowed transition table', () => {
        expect(HOME_CARE_REQUEST_TRANSITIONS.pending).toEqual(['confirmed', 'cancelled', 'rejected']);
        expect(HOME_CARE_REQUEST_TRANSITIONS.confirmed).toEqual(['cancelled', 'rejected']);
        expect(HOME_CARE_REQUEST_TRANSITIONS.in_progress).toEqual(['cancelled']);
    });

    test('allows operational transitions', () => {
        expect(() => assertHomeCareRequestTransition('pending', 'confirmed')).not.toThrow();
        expect(() => assertHomeCareRequestTransition('pending', 'rejected')).not.toThrow();
        expect(() => assertHomeCareRequestTransition('confirmed', 'rejected')).not.toThrow();
        expect(() => assertHomeCareRequestTransition('in_progress', 'cancelled')).not.toThrow();
    });

    test('rejects skipped and terminal transitions', () => {
        expect(() => assertHomeCareRequestTransition('pending', 'completed')).toThrow('غير مسموح');
        expect(() => assertHomeCareRequestTransition('completed', 'confirmed')).toThrow('غير مسموح');
        expect(() => assertHomeCareRequestTransition('cancelled', 'pending')).toThrow('غير مسموح');
        expect(() => assertHomeCareRequestTransition('rejected', 'confirmed')).toThrow('غير مسموح');
    });
});

describe('Home Care request persistence and formatters', () => {
    test('defines the practical transaction indexes', () => {
        const indexes = HomeCareRequest.schema.indexes();
        expect(indexes.some(([key, options]) => key.request_number === 1 && options.unique === true)).toBe(true);
        expect(indexes.some(([key]) => key.patient_id === 1 && key.createdAt === -1)).toBe(true);
        expect(indexes.some(([key]) => key.status === 1 && key.createdAt === -1)).toBe(true);
        expect(indexes.some(([key]) => key.requested_date === 1 && key.status === 1)).toBe(true);
        expect(indexes.some(([key]) => key.service_id === 1 && key.createdAt === -1)).toBe(true);
    });

    test('mobile formatter includes child details but never internal notes', () => {
        const formatted = formatHomeCareRequestForMobile(requestFixture(true));
        expect(formatted.beneficiary.type).toBe('CHILD');
        expect((formatted.beneficiary as any).child.full_name).toBe('طفل تجريبي');
        expect(formatted.service.price).toBe(15000);
        expect('internal_notes' in formatted).toBe(false);
        expect(Value.Check(MobileHomeCareRequestSchema, formatted)).toBe(true);
    });

    test('mobile exposes only safe assigned Nurse fields and returns null while unassigned', () => {
        expect(formatHomeCareRequestForMobile(requestFixture()).assigned_nurse).toBeNull();
        const assigned: any = requestFixture();
        assigned.dispatch = {
            status: 'CLAIMED', mode: 'OPEN_POOL', version: 1,
            nurse_id: { _id: new mongoose.Types.ObjectId(), full_name: 'سارة', profile_photo: null, license_verified: true, license_number: 'SECRET' },
        };
        const formatted = formatHomeCareRequestForMobile(assigned);
        expect(formatted.assigned_nurse).toMatchObject({ full_name: 'سارة', license_verified: true });
        expect(JSON.stringify(formatted)).not.toContain('SECRET');
        expect(JSON.stringify(formatted)).not.toContain('internal_notes');
    });

    test('dashboard formatter includes safe patient data and internal notes', () => {
        const formatted = formatHomeCareRequestForDashboard(requestFixture());
        expect(formatted.patient.full_name).toBe('مريض تجريبي');
        expect(formatted.internal_notes).toBe('ملاحظة لا تظهر للمريض');
        expect(JSON.stringify(formatted)).not.toContain('password');
        expect(Value.Check(DashboardHomeCareRequestSchema, formatted)).toBe(true);
    });
});
