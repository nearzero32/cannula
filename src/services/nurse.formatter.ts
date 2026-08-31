import type { NurseDocument } from '../models/nurse.model';

function service(value: unknown) {
    const item = value as { _id?: unknown; name?: string; status?: string; category_id?: unknown };
    return { _id: String(item?._id ?? value), name: item?.name ?? '', status: item?.status ?? '', category_id: String(item?.category_id ?? '') };
}
export function formatNurse(nurse: NurseDocument, includeInternal = false) {
    return {
        _id: String(nurse._id), user_id: String(nurse.user_id), full_name: nurse.full_name,
        gender: nurse.gender ?? null, profile_photo: nurse.profile_photo ?? null,
        specialty: nurse.specialty ?? null,
        license_number: includeInternal ? nurse.license_number ?? null : undefined,
        license_verified: nurse.license_verified,
        experience_years: nurse.experience_years ?? null,
        qualified_services: nurse.qualified_service_ids.map(service), status: nurse.status,
        createdAt: nurse.createdAt?.toISOString?.(), updatedAt: nurse.updatedAt?.toISOString?.(),
    };
}
