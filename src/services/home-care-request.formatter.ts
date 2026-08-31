import { calculateAge } from './patient-child.service';
import type { HomeCareRequestDocument } from '../models/home-care-request.model';

type PopulatedReference = {
    _id: unknown;
    full_name?: string;
    date_of_birth?: Date;
    phone?: string | null;
    profile_photo?: string | null;
    license_verified?: boolean;
};

function populatedReference(value: unknown): PopulatedReference | null {
    if (typeof value !== 'object' || value === null || !('_id' in value)) return null;
    return value as PopulatedReference;
}

function idString(value: unknown): string {
    const populated = populatedReference(value);
    return String(populated?._id ?? value);
}

function isoString(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function formatBeneficiary(request: HomeCareRequestDocument) {
    if (!request.child_id) return { type: 'SELF' as const };
    const child = populatedReference(request.child_id);
    if (!child?.full_name || !child.date_of_birth) {
        return { type: 'CHILD' as const, child: { _id: idString(request.child_id), full_name: '', age: 0 } };
    }
    return {
        type: 'CHILD' as const,
        child: {
            _id: idString(child),
            full_name: child.full_name,
            age: calculateAge(new Date(child.date_of_birth)),
        },
    };
}

function formatCancellation(request: HomeCareRequestDocument) {
    if (!request.cancelled_at || !request.cancelled_by) return null;
    return {
        cancelled_at: isoString(request.cancelled_at),
        cancelled_by: {
            id: String(request.cancelled_by.id),
            type: request.cancelled_by.type,
        },
        reason: request.cancellation_reason ?? null,
    };
}

export function formatHomeCareRequestForMobile(request: HomeCareRequestDocument) {
    const nurse = populatedReference(request.dispatch?.nurse_id);
    return {
        _id: String(request._id),
        request_number: request.request_number,
        service: {
            _id: String(request.service_id),
            category_id: String(request.category_id),
            name: request.service_name,
            price: request.service_price,
            duration_min: request.service_duration_min ?? null,
            duration_max: request.service_duration_max ?? null,
        },
        beneficiary: formatBeneficiary(request),
        requested_date: isoString(request.requested_date),
        preferred_time: request.preferred_time,
        address: {
            address_text: request.address.address_text,
            lat: request.address.lat,
            lng: request.address.lng,
        },
        notes: request.notes ?? null,
        status: request.status,
        assigned_nurse: nurse?.full_name ? {
            _id: idString(nurse), full_name: nurse.full_name ?? '',
            profile_photo: nurse.profile_photo ?? null,
            license_verified: nurse.license_verified ?? false,
        } : null,
        cancellation: formatCancellation(request),
        createdAt: isoString(request.createdAt),
        updatedAt: isoString(request.updatedAt),
    };
}

export function formatHomeCareRequestForDashboard(request: HomeCareRequestDocument) {
    const patient = populatedReference(request.patient_id);
    return {
        ...formatHomeCareRequestForMobile(request),
        patient: {
            _id: idString(request.patient_id),
            full_name: patient?.full_name ?? null,
            phone: patient?.phone ?? null,
            profile_photo: patient?.profile_photo ?? null,
        },
        internal_notes: request.internal_notes ?? null,
        dispatch: {
            status: request.dispatch?.status ?? 'OPEN',
            mode: request.dispatch?.mode ?? 'OPEN_POOL',
            nurse: formatHomeCareRequestForMobile(request).assigned_nurse,
            assigned_at: request.dispatch?.assigned_at ? isoString(request.dispatch.assigned_at) : null,
            assigned_by_user_id: request.dispatch?.assigned_by_user_id ? String(request.dispatch.assigned_by_user_id) : null,
            version: request.dispatch?.version ?? 0,
        },
    };
}

export function formatHomeCareRequestForNurse(request: HomeCareRequestDocument) {
    const patient = populatedReference(request.patient_id);
    return {
        ...formatHomeCareRequestForMobile(request),
        patient: {
            _id: idString(request.patient_id), full_name: patient?.full_name ?? null,
            phone: patient?.phone ?? null, profile_photo: patient?.profile_photo ?? null,
        },
    };
}
