import mongoose from 'mongoose';
import ChronicCondition from '../models/chronic-conditions.model';
import PatientHealthProfile, {
    type PatientHealthProfileDocument,
} from '../models/patient-health-profile.model';
import ChildHealthProfile, {
    type ChildHealthProfileDocument,
} from '../models/child-health-profile.model';
import type {
    HealthProfileFields,
    HealthProfileUpdate,
} from '../interfaces/health-profile.interface';
import { MEDICAL_NOTES_MAX_LENGTH } from '../models/health-profile-fields';
import { DomainError } from './domain-error';

export interface HealthProfileInput {
    blood_type?: HealthProfileFields['blood_type'];
    weight?: number | null;
    height?: number | null;
    allergies?: string[];
    chronic_condition_ids?: string[];
    current_medications?: string[];
    medical_notes?: string | null;
}

export function normalizeHealthStringList(values: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const rawValue of values) {
        const value = rawValue.trim();
        const key = value.toLocaleLowerCase();
        if (value && !seen.has(key)) {
            seen.add(key);
            result.push(value);
        }
    }
    return result;
}

function validatePositiveMeasurement(value: number | null | undefined, label: string): void {
    if (value !== undefined && value !== null && (!Number.isFinite(value) || value <= 0)) {
        throw new DomainError(`${label} يجب أن يكون أكبر من صفر`, 400);
    }
}

export function validateMedicalNotes(value: string | null | undefined): string | null | undefined {
    if (value === undefined || value === null) return value;
    const normalized = value.trim();
    if (normalized.length > MEDICAL_NOTES_MAX_LENGTH) {
        throw new DomainError(`الملاحظات الطبية يجب ألا تتجاوز ${MEDICAL_NOTES_MAX_LENGTH} حرف`, 400);
    }
    return normalized || null;
}

async function validateChronicConditions(ids: string[]): Promise<mongoose.Types.ObjectId[]> {
    if (ids.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
        throw new DomainError('أحد معرفات الأمراض المزمنة غير صالح', 400);
    }
    const uniqueIds = [...new Set(ids.map((id) => new mongoose.Types.ObjectId(id).toHexString()))];
    const objectIds = uniqueIds.map((id) => new mongoose.Types.ObjectId(id));
    const count = await ChronicCondition.countDocuments({ _id: { $in: objectIds } }).exec();
    if (count !== objectIds.length) {
        throw new DomainError('أحد الأمراض المزمنة غير موجود', 404);
    }
    return objectIds;
}

export async function prepareHealthProfileUpdate(input: HealthProfileInput): Promise<HealthProfileUpdate> {
    validatePositiveMeasurement(input.weight, 'الوزن');
    validatePositiveMeasurement(input.height, 'الطول');

    const update: HealthProfileUpdate = {};
    if (input.blood_type !== undefined) update.blood_type = input.blood_type;
    if (input.weight !== undefined) update.weight = input.weight;
    if (input.height !== undefined) update.height = input.height;
    if (input.allergies !== undefined) update.allergies = normalizeHealthStringList(input.allergies);
    if (input.current_medications !== undefined) {
        update.current_medications = normalizeHealthStringList(input.current_medications);
    }
    if (input.medical_notes !== undefined) update.medical_notes = validateMedicalNotes(input.medical_notes);
    if (input.chronic_condition_ids !== undefined) {
        update.chronic_condition_ids = await validateChronicConditions(input.chronic_condition_ids);
    }
    return update;
}

type HealthDocument = PatientHealthProfileDocument | ChildHealthProfileDocument;

export async function formatHealthProfile(profile: HealthDocument) {
    const conditions = profile.chronic_condition_ids.length
        ? await ChronicCondition.find({ _id: { $in: profile.chronic_condition_ids } })
            .select({ _id: 1, name: 1 })
            .lean()
            .exec()
        : [];
    return {
        blood_type: profile.blood_type ?? null,
        weight: profile.weight ?? null,
        height: profile.height ?? null,
        allergies: profile.allergies,
        chronic_conditions: conditions.map((condition) => ({
            _id: condition._id.toString(),
            name: condition.name,
        })),
        current_medications: profile.current_medications,
        medical_notes: profile.medical_notes ?? null,
        updatedAt: profile.updatedAt,
    };
}

export class PatientHealthProfileService {
    async getOrCreate(patientId: mongoose.Types.ObjectId): Promise<PatientHealthProfileDocument> {
        const profile = await PatientHealthProfile.findOneAndUpdate(
            { patient_id: patientId },
            { $setOnInsert: { patient_id: patientId } },
            { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
        ).exec();
        if (!profile) throw new Error('Failed to create patient health profile');
        return profile;
    }

    async update(patientId: mongoose.Types.ObjectId, input: HealthProfileInput) {
        const update = await prepareHealthProfileUpdate(input);
        const profile = await PatientHealthProfile.findOneAndUpdate(
            { patient_id: patientId },
            { $set: update, $setOnInsert: { patient_id: patientId } },
            { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
        ).exec();
        if (!profile) throw new Error('Failed to update patient health profile');
        return profile;
    }
}

export class ChildHealthProfileService {
    async getOrCreate(childId: mongoose.Types.ObjectId): Promise<ChildHealthProfileDocument> {
        const profile = await ChildHealthProfile.findOneAndUpdate(
            { child_id: childId },
            { $setOnInsert: { child_id: childId } },
            { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
        ).exec();
        if (!profile) throw new Error('Failed to create child health profile');
        return profile;
    }

    async update(childId: mongoose.Types.ObjectId, input: HealthProfileInput) {
        const update = await prepareHealthProfileUpdate(input);
        const profile = await ChildHealthProfile.findOneAndUpdate(
            { child_id: childId },
            { $set: update, $setOnInsert: { child_id: childId } },
            { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
        ).exec();
        if (!profile) throw new Error('Failed to update child health profile');
        return profile;
    }
}

export const patientHealthProfileService = new PatientHealthProfileService();
export const childHealthProfileService = new ChildHealthProfileService();
