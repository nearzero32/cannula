import { calculateAge } from './patient-child.service';
import type { PharmacyTreatmentRequestDocument } from '../models/pharmacy-treatment-request.model';
import type { PharmacyDocument } from '../models/pharmacy.model';

type Ref = { _id?: unknown; full_name?: string; phone?: string | null; profile_photo?: string | null; date_of_birth?: Date; name?: string; display_name?: string | null; logo?: string | null; license_verified?: boolean; status?: string };
const ref = (value: unknown): Ref | null => typeof value === 'object' && value !== null ? value as Ref : null;
const id = (value: unknown) => String(ref(value)?._id ?? value ?? '');
const iso = (value: unknown) => value ? new Date(value as Date).toISOString() : null;

export function formatPharmacy(pharmacy: PharmacyDocument, internal = false) {
    return {
        _id: String(pharmacy._id), user_id: String(pharmacy.user_id), name: pharmacy.name,
        display_name: pharmacy.display_name ?? null, logo: pharmacy.logo ?? null, phone: pharmacy.phone,
        license_number: internal ? pharmacy.license_number ?? null : undefined,
        license_verified: pharmacy.license_verified,
        address: { address_text: pharmacy.address.address_text, lat: pharmacy.address.lat ?? null, lng: pharmacy.address.lng ?? null },
        accepts_prescription_requests: pharmacy.accepts_prescription_requests, status: pharmacy.status,
        notes_internal: internal ? pharmacy.notes_internal ?? null : undefined,
        createdAt: iso(pharmacy.createdAt), updatedAt: iso(pharmacy.updatedAt),
    };
}

function beneficiary(request: PharmacyTreatmentRequestDocument) {
    if (!request.child_id) return { type: 'SELF' as const };
    const child = ref(request.child_id);
    return { type: 'CHILD' as const, child: { _id: id(request.child_id), full_name: child?.full_name ?? '', age: child?.date_of_birth ? calculateAge(new Date(child.date_of_birth)) : 0 } };
}
function pharmacy(value: unknown) {
    const p = ref(value); if (!value) return null;
    return { _id: id(value), name: p?.name ?? '', display_name: p?.display_name ?? null, logo: p?.logo ?? null, phone: p?.phone ?? null, license_verified: p?.license_verified ?? false, status: p?.status ?? '' };
}
function quotation(value: any) {
    if (!value?.version) return null;
    return { version: value.version, pharmacy_id: id(value.pharmacy_id), items: value.items.map((x: any) => ({ name: x.name, quantity: x.quantity, unit_price: x.unit_price, line_total: x.line_total, note: x.note ?? null })), unavailable_items: value.unavailable_items.map((x: any) => ({ name: x.name, note: x.note ?? null })), medicines_subtotal: value.medicines_subtotal, delivery_fee: value.delivery_fee, discount: value.discount, total_price: value.total_price, pharmacy_note: value.pharmacy_note ?? null, quoted_at: iso(value.quoted_at)!, accepted_at: iso(value.accepted_at) };
}
function base(request: PharmacyTreatmentRequestDocument) {
    return { _id: String(request._id), request_number: request.request_number, beneficiary: beneficiary(request), treatment_details: request.treatment_details ?? null, delivery_address: request.delivery_address, delivery_phone: request.delivery_phone, notes: request.notes ?? null, preferred_payment_method: request.preferred_payment_method, status: request.status, workflowVersion: request.workflowVersion ?? 0, quotation: quotation(request.quotation), accepted_quotation: quotation(request.accepted_quotation), cancellation: request.cancelled_at ? { cancelled_at: iso(request.cancelled_at)!, cancelled_by_user_id: request.cancelled_by_user_id ? String(request.cancelled_by_user_id) : null, actor_type: request.cancellation_actor_type ?? null, reason: request.cancellation_reason ?? null } : null, createdAt: iso(request.createdAt)!, updatedAt: iso(request.updatedAt)! };
}
export const formatPharmacyRequestForAvailable = (r: PharmacyTreatmentRequestDocument) => ({ _id: String(r._id), request_number: r.request_number, beneficiary: beneficiary(r), has_prescription_images: r.prescription_images.length > 0, treatment_preview: (r.treatment_details ?? '').slice(0, 240) || null, delivery_area: r.delivery_address.address_text, preferred_payment_method: r.preferred_payment_method, createdAt: iso(r.createdAt)! });
export const formatPharmacyRequestForPatient = (r: PharmacyTreatmentRequestDocument) => ({ ...base(r), prescription_images: r.prescription_images, current_pharmacy: pharmacy(r.dispatch?.pharmacy_id) });
export const formatPharmacyRequestForPharmacy = (r: PharmacyTreatmentRequestDocument) => { const p = ref(r.patient_id); return { ...base(r), prescription_images: r.prescription_images, patient: { _id: id(r.patient_id), full_name: p?.full_name ?? null, phone: p?.phone ?? null, profile_photo: p?.profile_photo ?? null } }; };
export const formatPharmacyRequestForAdmin = (r: PharmacyTreatmentRequestDocument) => { const p = ref(r.patient_id); return { ...formatPharmacyRequestForPatient(r), patient: { _id: id(r.patient_id), full_name: p?.full_name ?? null, phone: p?.phone ?? null, profile_photo: p?.profile_photo ?? null }, dispatch: { status: r.dispatch.status, mode: r.dispatch.mode, pharmacy: pharmacy(r.dispatch.pharmacy_id), assigned_at: iso(r.dispatch.assigned_at), assigned_by_user_id: r.dispatch.assigned_by_user_id ? String(r.dispatch.assigned_by_user_id) : null, version: r.dispatch.version }, excluded_pharmacy_ids: (r.excluded_pharmacy_ids??[]).map(String) }; };
export function formatPharmacyHistory(h: any) { return { _id: String(h._id), request_id: String(h.request_id), request_number: h.request_number, event_type: h.event_type, actor: { type: h.actor.type, user_id: h.actor.user_id ? String(h.actor.user_id) : null, pharmacy_id: h.actor.pharmacy_id ? String(h.actor.pharmacy_id) : null }, from_status: h.from_status ?? null, to_status: h.to_status ?? null, from_pharmacy_id: h.from_pharmacy_id ? String(h.from_pharmacy_id) : null, to_pharmacy_id: h.to_pharmacy_id ? String(h.to_pharmacy_id) : null, quotation_version: h.quotation_version ?? null, total_price: h.total_price ?? null, reason: h.reason ?? null, metadata: h.metadata ?? null, createdAt: iso(h.createdAt)! }; }
