import Doctor, { DoctorDocument } from '../models/doctors.model';
import type { IDoctor } from '../interfaces/doctor.interface';
import type { PipelineStage } from 'mongoose';
import ActivityLogService from './activity-log.service';
import { IActivityLogActionEnum, IActivityLogSourceEnum } from '../interfaces/activity-log.interface';
import sessionService from './session.service';
import { IDoctorStatusEnum, IDoctorVerificationStatusEnum } from '../interfaces/doctor.interface';
import uploadPolicyService from './upload-policy.service';
import { UploadPurposeEnum } from '../constants/upload-policy';
import mongoose from 'mongoose';
import { DomainError } from './domain-error';

/**
 * Patient collection rule: filters determine membership; this sort determines
 * presentation. Keep the _id tie-breaker for stable pagination.
 */
export const PATIENT_DOCTOR_SORT = Object.freeze({ display_order: 1, _id: 1 } as const);

/** A profile is public independently from whether it accepts new bookings. */
export const PUBLIC_DOCTOR_MATCH = Object.freeze({
    status: IDoctorStatusEnum.ACTIVE,
    verification_status: IDoctorVerificationStatusEnum.VERIFIED,
    license_verified: true,
} as const);

export function publicDoctorMatch(prefix = ''): Record<string, unknown> {
    if (!prefix) return { ...PUBLIC_DOCTOR_MATCH };
    return Object.fromEntries(Object.entries(PUBLIC_DOCTOR_MATCH).map(([key, value]) => [`${prefix}.${key}`, value]));
}

/** Builds the canonical doctor sort for a document produced by a $lookup. */
export function patientDoctorSort(prefix = ''): Record<string, 1> {
    if (!prefix) return { ...PATIENT_DOCTOR_SORT };
    return {
        [`${prefix}.display_order`]: 1,
        [`${prefix}._id`]: 1,
    };
}

class DoctorService {
    private model = Doctor;
    private activityLog = ActivityLogService;

    public async getPaginated({
        main_match,
        additional_pipeline = [],
        projection,
        page = 1,
        limit = 10,
        sort = { createdAt: -1 },
    }: {
        main_match: Record<string, unknown>;
        additional_pipeline?: PipelineStage.FacetPipelineStage[];
        projection?: PipelineStage.Project['$project'] | null;
        page?: number;
        limit?: number;
        sort?: Record<string, 1 | -1>;
    }): Promise<{ data: DoctorDocument[]; count: number }> {
        const safePage = Math.max(1, page);
        const safeLimit = Math.min(100, Math.max(1, limit));
        const skip = (safePage - 1) * safeLimit;

        const pipeline: PipelineStage[] = [
            { $match: main_match },
            {
                $facet: {
                    data: [
                        { $sort: sort },
                        { $skip: skip },
                        { $limit: safeLimit },
                        ...additional_pipeline,
                        ...(projection ? [{ $project: projection } as PipelineStage.Project] : []),
                    ],
                    count: [{ $count: 'count' }],
                },
            },
        ];

        const [agg] = await this.model.aggregate(pipeline).exec();
        return {
            data: (agg?.data ?? []) as DoctorDocument[],
            count: agg?.count?.[0]?.count ?? 0,
        };
    }

    public async getOneBy({
        main_match = { $match: {} },
        additional_pipeline = [],
        projection = null,
    }: {
        main_match?: PipelineStage.FacetPipelineStage;
        additional_pipeline?: PipelineStage.FacetPipelineStage[];
        projection?: PipelineStage.Project['$project'] | null;
    }): Promise<DoctorDocument | null> {
        const pipeline: PipelineStage[] = [
            main_match,
            ...additional_pipeline,
            ...(projection ? [{ $project: projection } as PipelineStage.Project] : []),
            { $limit: 1 },
        ];
        const [doc] = await this.model.aggregate(pipeline).exec();
        return (doc as DoctorDocument) ?? null;
    }

    public async getById(id: string): Promise<DoctorDocument | null> {
        return await this.model.findById(id).exec();
    }

    public async getByUserId(user_id: string): Promise<DoctorDocument | null> {
        return await this.model.findOne({ user_id }).exec();
    }

    public async create(payload: Partial<IDoctor>, meta?: { user_id?: string; user_name?: string; user_type?: string; endpoint?: string; source?: string }): Promise<DoctorDocument> {
        if(payload.profile_photo)throw new (await import('./domain-error')).DomainError('أنشئ ملف الطبيب ثم ارفع صورته لغرضه المحدد',422,'UPLOAD_TARGET_NOT_FOUND');
        const doc = await this.model.create(payload);
        if (doc.status !== IDoctorStatusEnum.ACTIVE) await sessionService.revokeAll(String(doc.user_id), { reasonCode: 'DOCTOR_STATUS_DISABLED' });
        try {
            await this.activityLog.logActivity({
                user_id: meta?.user_id,
                user_name: meta?.user_name,
                user_type: meta?.user_type,
                method: 'POST',
                endpoint: meta?.endpoint || '/doctors',
                action: IActivityLogActionEnum.CREATE,
                collection_name: 'doctors',
                document_id: (doc._id as any).toString(),
                new_data: doc.toObject(),
                request_body: payload,
                source: meta?.source || IActivityLogSourceEnum.DASHBOARD,
            });
        } catch {}
        return doc;
    }

    public async update(id: string, payload: Partial<IDoctor>, meta?: { user_id?: string; user_name?: string; user_type?: string; endpoint?: string; source?: string }): Promise<DoctorDocument | null> {
        const oldDoc = await this.model.findById(id).exec();
        const media = payload.profile_photo !== undefined && payload.profile_photo !== null
            ? await uploadPolicyService.requireReadyReference(payload.profile_photo, UploadPurposeEnum.DOCTOR_PROFILE_PHOTO, 'DOCTOR', id) : null;
        if (oldDoc && payload.status !== undefined && payload.status !== IDoctorStatusEnum.ACTIVE && payload.status !== oldDoc.status) {
            await sessionService.revokeAll(String(oldDoc.user_id), { reasonCode: 'DOCTOR_STATUS_DISABLED' });
        }
        const doc = await this.model.findByIdAndUpdate(id, payload, { returnDocument: 'after' }).exec();
        if (doc && payload.profile_photo !== undefined) await uploadPolicyService.finalizeReplacement(media, oldDoc?.profile_photo, id, 'profile_photo');
        if (doc && oldDoc) {
            try {
                const changed_fields = Object.keys(payload).filter(k => JSON.stringify((oldDoc as any)[k]) !== JSON.stringify((doc as any)[k]));
                await this.activityLog.logActivity({
                    user_id: meta?.user_id,
                    user_name: meta?.user_name,
                    user_type: meta?.user_type,
                    method: 'PATCH',
                    endpoint: meta?.endpoint || `/doctors/${id}`,
                    action: IActivityLogActionEnum.UPDATE,
                    collection_name: 'doctors',
                    document_id: id,
                    old_data: oldDoc.toObject(),
                    new_data: doc.toObject(),
                    changed_fields,
                    request_body: payload,
                    source: meta?.source || IActivityLogSourceEnum.DASHBOARD,
                });
            } catch {}
        }
        return doc;
    }

    public async reorder(
        doctorIds: string[],
        meta?: { user_id?: string; user_name?: string; user_type?: string; endpoint?: string; source?: string },
    ): Promise<{ doctorIds: string[]; displayOrders: number[] }> {
        if (!doctorIds.length || doctorIds.length > 500) {
            throw new DomainError('قائمة الأطباء غير صالحة', 400, 'INVALID_DOCTOR_ORDER');
        }
        if (doctorIds.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
            throw new DomainError('معرف طبيب غير صالح', 400, 'INVALID_DOCTOR_ID');
        }
        if (new Set(doctorIds).size !== doctorIds.length) {
            throw new DomainError('لا يمكن تكرار الطبيب في الترتيب', 400, 'DUPLICATE_DOCTOR_ID');
        }

        const objectIds = doctorIds.map((id) => new mongoose.Types.ObjectId(id));
        const session = await this.model.db.startSession();
        try {
            let oldOrders: Array<{ _id: mongoose.Types.ObjectId; display_order?: number }> = [];
            await session.withTransaction(async () => {
                oldOrders = await this.model.find({ _id: { $in: objectIds } })
                    .select('_id display_order')
                    .session(session)
                    .lean()
                    .exec();
                if (oldOrders.length !== doctorIds.length) {
                    throw new DomainError('يوجد طبيب غير موجود في قائمة الترتيب', 404, 'DOCTOR_NOT_FOUND');
                }

                const result = await this.model.bulkWrite(
                    doctorIds.map((id, index) => ({
                        updateOne: {
                            filter: { _id: new mongoose.Types.ObjectId(id) },
                            update: { $set: { display_order: (index + 1) * 10 } },
                        },
                    })),
                    { ordered: true, session },
                );
                if (result.matchedCount !== doctorIds.length) {
                    throw new DomainError('تعذر تحديث ترتيب الأطباء', 409, 'DOCTOR_ORDER_CONFLICT');
                }
            });

            const displayOrders = doctorIds.map((_, index) => (index + 1) * 10);
            try {
                await this.activityLog.logActivity({
                    user_id: meta?.user_id,
                    user_name: meta?.user_name,
                    user_type: meta?.user_type,
                    method: 'PATCH',
                    endpoint: meta?.endpoint || '/doctors/order',
                    action: IActivityLogActionEnum.BULK_UPDATE,
                    collection_name: 'doctors',
                    old_data: oldOrders.map((doctor) => ({ id: String(doctor._id), display_order: doctor.display_order ?? null })),
                    new_data: doctorIds.map((id, index) => ({ id, display_order: displayOrders[index] })),
                    changed_fields: ['display_order'],
                    request_body: { doctorIds },
                    source: meta?.source || IActivityLogSourceEnum.DASHBOARD,
                });
            } catch {}
            return { doctorIds, displayOrders };
        } finally {
            await session.endSession();
        }
    }

}

export default new DoctorService();
