import mongoose from 'mongoose';
import Patient from '../models/patients.model';
import PatientChild from '../models/patient-child.model';
import PatientHealthProfile from '../models/patient-health-profile.model';
import ChildHealthProfile from '../models/child-health-profile.model';
import { BloodTypeEnum, type BloodType } from '../interfaces/health-profile.interface';
import { normalizeHealthStringList } from '../services/health-profile.service';

export interface LegacyPatientHealthRow {
    _id: mongoose.Types.ObjectId;
    blood_group?: string | null;
    allergies?: string[];
    chronic_condition_ids?: string[];
}

export interface HealthBackfillDependencies {
    listPatients(): Promise<LegacyPatientHealthRow[]>;
    upsertPatientProfile(patient: LegacyPatientHealthRow): Promise<boolean>;
    clearLegacyPatientHealth(patientId: mongoose.Types.ObjectId): Promise<void>;
    listChildIds(): Promise<mongoose.Types.ObjectId[]>;
    upsertChildProfile(childId: mongoose.Types.ObjectId): Promise<boolean>;
}

export interface HealthBackfillResult {
    patient_profiles_created: number;
    child_profiles_created: number;
    patients_cleaned: number;
}

export async function runHealthProfileBackfill(
    dependencies: HealthBackfillDependencies
): Promise<HealthBackfillResult> {
    let patientProfilesCreated = 0;
    let childProfilesCreated = 0;
    let patientsCleaned = 0;

    for (const patient of await dependencies.listPatients()) {
        if (await dependencies.upsertPatientProfile(patient)) patientProfilesCreated += 1;
        await dependencies.clearLegacyPatientHealth(patient._id);
        patientsCleaned += 1;
    }
    for (const childId of await dependencies.listChildIds()) {
        if (await dependencies.upsertChildProfile(childId)) childProfilesCreated += 1;
    }
    return {
        patient_profiles_created: patientProfilesCreated,
        child_profiles_created: childProfilesCreated,
        patients_cleaned: patientsCleaned,
    };
}

function validBloodType(value: string | null | undefined): BloodType | null {
    return Object.values(BloodTypeEnum).includes(value as BloodType) ? value as BloodType : null;
}

export async function backfillHealthProfiles(): Promise<HealthBackfillResult> {
    const dependencies: HealthBackfillDependencies = {
        async listPatients() {
            return await Patient.collection.find({}, {
                projection: { _id: 1, blood_group: 1, allergies: 1, chronic_condition_ids: 1 },
            }).toArray() as LegacyPatientHealthRow[];
        },
        async upsertPatientProfile(patient) {
            const chronicConditionIds = (patient.chronic_condition_ids ?? [])
                .filter((id) => mongoose.Types.ObjectId.isValid(id))
                .map((id) => new mongoose.Types.ObjectId(id));
            const result = await PatientHealthProfile.updateOne(
                { patient_id: patient._id },
                {
                    $setOnInsert: {
                        patient_id: patient._id,
                        blood_type: validBloodType(patient.blood_group),
                        allergies: normalizeHealthStringList(patient.allergies ?? []),
                        chronic_condition_ids: chronicConditionIds,
                    },
                },
                { upsert: true }
            ).exec();
            return result.upsertedCount === 1;
        },
        async clearLegacyPatientHealth(patientId) {
            await Patient.collection.updateOne(
                { _id: patientId },
                { $unset: { blood_group: '', allergies: '', chronic_condition_ids: '' } }
            );
        },
        async listChildIds() {
            const children = await PatientChild.find({}).select({ _id: 1 }).lean().exec();
            return children.map((child) => new mongoose.Types.ObjectId(child._id.toString()));
        },
        async upsertChildProfile(childId) {
            const result = await ChildHealthProfile.updateOne(
                { child_id: childId },
                { $setOnInsert: { child_id: childId } },
                { upsert: true }
            ).exec();
            return result.upsertedCount === 1;
        },
    };

    const result = await runHealthProfileBackfill(dependencies);
    console.log(
        `[Migration] Health profiles: ${result.patient_profiles_created} patient profiles created, ` +
        `${result.child_profiles_created} child profiles created, ${result.patients_cleaned} patients checked`
    );
    return result;
}
