import mongoose from 'mongoose';
import PatientChild, { type PatientChildDocument } from '../models/patient-child.model';
import ChildHealthProfile from '../models/child-health-profile.model';
import type {
    PatientChildCreateInput,
    PatientChildStatus,
    PatientChildUpdateInput,
} from '../interfaces/patient-child.interface';
import { PatientChildRelationshipEnum, PatientChildStatusEnum } from '../interfaces/patient-child.interface';
import { DomainError } from './domain-error';
import {
    childHealthProfileService,
    type PatientManagedHealthProfileInput,
} from './health-profile.service';
import { calculateAge, formatDateOfBirth } from './date-of-birth';
import uploadPolicyService from './upload-policy.service'; import {UploadPurposeEnum} from '../constants/upload-policy';

export { calculateAge } from './date-of-birth';

export function validateChildDateOfBirth(dateOfBirth: Date): void {
    if (Number.isNaN(dateOfBirth.getTime())) throw new DomainError('تاريخ الميلاد غير صالح', 400);
    if (dateOfBirth.getTime() > Date.now()) {
        throw new DomainError('تاريخ الميلاد لا يمكن أن يكون في المستقبل', 400);
    }
}

export function ownedChildFilter(patientId: mongoose.Types.ObjectId, childId: string) {
    if (!mongoose.Types.ObjectId.isValid(childId)) return null;
    return { _id: new mongoose.Types.ObjectId(childId), patient_id: patientId };
}

export function formatPatientChild(child: PatientChildDocument) {
    return {
        _id: child._id.toString(),
        full_name: child.full_name,
        date_of_birth: formatDateOfBirth(child.date_of_birth),
        age: calculateAge(child.date_of_birth),
        gender: child.gender,
        relationship: child.relationship ?? PatientChildRelationshipEnum.OTHER,
        photo: child.photo ?? null,
        status: child.status,
        createdAt: child.createdAt,
        updatedAt: child.updatedAt,
    };
}

export class PatientChildService {
    async list(patientId: mongoose.Types.ObjectId, includeInactive = false) {
        const filter: Record<string, unknown> = { patient_id: patientId };
        if (!includeInactive) filter.status = PatientChildStatusEnum.ACTIVE;
        return await PatientChild.find(filter).sort({ createdAt: 1 }).exec();
    }

    async findOwnedChild(patientId: mongoose.Types.ObjectId, childId: string) {
        const filter = ownedChildFilter(patientId, childId);
        if (!filter) return null;
        return await PatientChild.findOne(filter).exec();
    }

    async requireOwnedChild(patientId: mongoose.Types.ObjectId, childId: string) {
        const child = await this.findOwnedChild(patientId, childId);
        if (!child) throw new DomainError('الطفل غير موجود', 404);
        return child;
    }

    async create(patientId: mongoose.Types.ObjectId, input: PatientChildCreateInput) {
        const fullName = input.full_name.trim();
        if (!fullName) throw new DomainError('اسم الطفل مطلوب', 400);
        validateChildDateOfBirth(input.date_of_birth);

        if(input.photo) throw new DomainError('أنشئ سجل الطفل ثم ارفع صورته لغرضه المحدد',422,'UPLOAD_TARGET_NOT_FOUND');
        const child = await PatientChild.create({
            patient_id: patientId,
            full_name: fullName,
            date_of_birth: input.date_of_birth,
            gender: input.gender,
            relationship: input.relationship,
            photo: input.photo?.trim() || null,
            status: PatientChildStatusEnum.ACTIVE,
        });
        try {
            await ChildHealthProfile.create({ child_id: child._id });
        } catch (error) {
            await PatientChild.findByIdAndDelete(child._id).exec();
            throw error;
        }
        return child;
    }

    async update(patientId: mongoose.Types.ObjectId, childId: string, input: PatientChildUpdateInput) {
        const current = await this.requireOwnedChild(patientId, childId);
        const media=input.photo!==undefined&&input.photo!==null?await uploadPolicyService.requireReadyReference(input.photo,UploadPurposeEnum.PATIENT_CHILD_PHOTO,'PATIENT_CHILD',childId):null;
        const update: PatientChildUpdateInput = {};
        if (input.full_name !== undefined) {
            const fullName = input.full_name.trim();
            if (!fullName) throw new DomainError('اسم الطفل مطلوب', 400);
            update.full_name = fullName;
        }
        if (input.date_of_birth !== undefined) {
            validateChildDateOfBirth(input.date_of_birth);
            update.date_of_birth = input.date_of_birth;
        }
        if (input.gender !== undefined) update.gender = input.gender;
        if (input.relationship !== undefined) update.relationship = input.relationship;
        if (input.photo !== undefined) update.photo = input.photo?.trim() || null;
        const updated=await PatientChild.findOneAndUpdate(
            { _id: current._id, patient_id: patientId },
            { $set: update },
            { returnDocument: 'after', runValidators: true }
        ).exec();
        if(updated&&input.photo!==undefined)await uploadPolicyService.finalizeReplacement(media,current.photo,childId,'photo');return updated;
    }

    async updateStatus(
        patientId: mongoose.Types.ObjectId,
        childId: string,
        status: PatientChildStatus
    ) {
        const child = await this.requireOwnedChild(patientId, childId);
        return await PatientChild.findOneAndUpdate(
            { _id: child._id, patient_id: patientId },
            { $set: { status } },
            { returnDocument: 'after', runValidators: true }
        ).exec();
    }

    async getOwnedHealthProfile(patientId: mongoose.Types.ObjectId, childId: string) {
        const child = await this.requireOwnedChild(patientId, childId);
        const profile = await childHealthProfileService.getOrCreate(
            new mongoose.Types.ObjectId(child._id.toString())
        );
        return { child, profile };
    }

    async updateOwnedHealthProfile(
        patientId: mongoose.Types.ObjectId,
        childId: string,
        input: PatientManagedHealthProfileInput
    ) {
        const child = await this.requireOwnedChild(patientId, childId);
        const profile = await childHealthProfileService.update(
            new mongoose.Types.ObjectId(child._id.toString()),
            input
        );
        return { child, profile };
    }
}

export default new PatientChildService();
