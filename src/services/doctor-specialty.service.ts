import mongoose from 'mongoose';
import Specialty from '../models/specialties.model';
import { ISpecialtyStatusEnum } from '../interfaces/specialty.interface';
import { DomainError } from './domain-error';

const asObjectId = (value: string) => {
    if (!mongoose.Types.ObjectId.isValid(value)) throw new DomainError('معرف التخصص غير صالح', 400, 'SPECIALTY_INVALID');
    return new mongoose.Types.ObjectId(value);
};

export async function validateDoctorSpecialties(primaryId: string, ids: string[]) {
    const unique = [...new Set([primaryId, ...ids])];
    const objectIds = unique.map(asObjectId);
    const count = await Specialty.countDocuments({ _id: { $in: objectIds }, status: ISpecialtyStatusEnum.ACTIVE });
    if (count !== objectIds.length) throw new DomainError('يتضمن الطلب تخصصاً غير موجود أو غير فعال', 422, 'SPECIALTY_INVALID');
    return { primary_specialty_id: asObjectId(primaryId), specialty_ids: objectIds };
}

export async function doctorSpecialtyMap(doctors: Array<{ primary_specialty_id: unknown; specialty_ids: unknown[] }>) {
    const ids = [...new Set(doctors.flatMap(doctor => [doctor.primary_specialty_id, ...(doctor.specialty_ids ?? [])]).filter(Boolean).map(String))];
    const rows = ids.length ? await Specialty.find({ _id: { $in: ids.map(asObjectId) } }).select('name icon status').lean().exec() : [];
    return new Map(rows.map(row => [String(row._id), { _id: String(row._id), name: row.name, icon: row.icon ?? null }]));
}
