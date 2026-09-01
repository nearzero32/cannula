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
    PatientManagedHealthProfileUpdate,
} from '../interfaces/health-profile.interface';
import { DomainError } from './domain-error';
import { IChronicConditionStatusEnum } from '../interfaces/chronic-condition.interface';

export const MAX_ALLERGIES = 50;
export const ALLERGY_MAX_LENGTH = 120;
export const MAX_CHRONIC_CONDITIONS = 50;

export interface PatientManagedHealthProfileInput {
    blood_type?: HealthProfileFields['blood_type'];
    allergies?: string[];
    chronic_condition_ids?: string[];
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

export function normalizeAllergies(values: string[]): string[] {
    if (values.length > MAX_ALLERGIES) {
        throw new DomainError(`يجب ألا يتجاوز عدد الحساسية ${MAX_ALLERGIES}`, 400);
    }
    if (values.some((value) => !value.trim())) {
        throw new DomainError('لا يمكن أن تكون الحساسية فارغة', 400);
    }
    if (values.some((value) => value.trim().length > ALLERGY_MAX_LENGTH)) {
        throw new DomainError(`يجب ألا يتجاوز اسم الحساسية ${ALLERGY_MAX_LENGTH} حرف`, 400);
    }
    return normalizeHealthStringList(values);
}

async function validateChronicConditions(ids: string[]): Promise<mongoose.Types.ObjectId[]> {
    if (ids.length > MAX_CHRONIC_CONDITIONS) {
        throw new DomainError(`يجب ألا يتجاوز عدد الأمراض المزمنة ${MAX_CHRONIC_CONDITIONS}`, 400);
    }
    if (ids.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
        throw new DomainError('أحد معرفات الأمراض المزمنة غير صالح', 400);
    }
    const uniqueIds = [...new Set(ids.map((id) => new mongoose.Types.ObjectId(id).toHexString()))];
    const objectIds = uniqueIds.map((id) => new mongoose.Types.ObjectId(id));
    const count = await ChronicCondition.countDocuments({
        _id: { $in: objectIds },
        status: IChronicConditionStatusEnum.ACTIVE,
    }).exec();
    if (count !== objectIds.length) {
        throw new DomainError('أحد الأمراض المزمنة غير موجود', 404);
    }
    return objectIds;
}

export async function prepareHealthProfileUpdate(
    input: PatientManagedHealthProfileInput
): Promise<PatientManagedHealthProfileUpdate> {
    const update: PatientManagedHealthProfileUpdate = {};
    if (input.blood_type !== undefined) update.blood_type = input.blood_type;
    if (input.allergies !== undefined) update.allergies = normalizeAllergies(input.allergies);
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
        allergies: profile.allergies,
        chronic_conditions: conditions.map((condition) => ({
            _id: condition._id.toString(),
            name: condition.name,
        })),
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

    async update(patientId: mongoose.Types.ObjectId, input: PatientManagedHealthProfileInput) {
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

    async update(childId: mongoose.Types.ObjectId, input: PatientManagedHealthProfileInput) {
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
