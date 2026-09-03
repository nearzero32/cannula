import mongoose, { type FilterQuery } from 'mongoose';
import Nurse, { type NurseDocument } from '../models/nurse.model';
import User from '../models/users.model';
import HomeCareService from '../models/home-care-service.model';
import { INurseStatusEnum, type INurse, type INurseStatus } from '../interfaces/nurse.interface';
import { IUserRoleEnum } from '../interfaces/user.interface';
import { DomainError } from './domain-error';
import ActivityLogService from './activity-log.service';
import { IActivityLogActionEnum, IActivityLogSourceEnum } from '../interfaces/activity-log.interface';
import sessionService from './session.service';
import uploadPolicyService from './upload-policy.service'; import {UploadPurposeEnum} from '../constants/upload-policy';

export interface NurseWriteActor { user_id: string; endpoint: string }

function ids(values: string[]): mongoose.Types.ObjectId[] {
    if (values.some(value => !mongoose.Types.ObjectId.isValid(value))) throw new DomainError('معرف خدمة غير صالح', 400);
    return [...new Set(values)].map(value => new mongoose.Types.ObjectId(value));
}

export class NurseService {
    public async getById(id: string): Promise<NurseDocument | null> {
        if (!mongoose.Types.ObjectId.isValid(id)) return null;
        return Nurse.findById(id).populate({ path: 'qualified_service_ids', select: 'name status category_id' }).exec();
    }
    public async getByUserId(userId: string): Promise<NurseDocument | null> {
        if (!mongoose.Types.ObjectId.isValid(userId)) return null;
        return Nurse.findOne({ user_id: userId }).populate({ path: 'qualified_service_ids', select: 'name status category_id' }).exec();
    }
    public async requireActiveByUserId(userId: string): Promise<NurseDocument> {
        const nurse = await this.getByUserId(userId);
        if (!nurse) throw new DomainError('الملف الشخصي للممرض غير موجود', 404);
        if (nurse.status !== INurseStatusEnum.ACTIVE) throw new DomainError('حساب الممرض غير فعال', 403);
        return nurse;
    }
    public async requireActiveQualified(nurseId: string, serviceId: unknown): Promise<NurseDocument> {
        if (!mongoose.Types.ObjectId.isValid(nurseId)) throw new DomainError('معرف الممرض غير صالح', 400);
        const nurse = await Nurse.findOne({ _id: nurseId, status: INurseStatusEnum.ACTIVE }).exec();
        if (!nurse) throw new DomainError('الممرض غير موجود أو غير فعال', 404);
        if (!nurse.qualified_service_ids.some(id => String(id) === String(serviceId))) {
            throw new DomainError('الممرض غير مؤهل لتنفيذ هذه الخدمة', 422);
        }
        return nurse;
    }
    public async list(query: { page?: number; limit?: number; status?: INurseStatus; search?: string }) {
        const page = Math.max(1, query.page ?? 1), limit = Math.min(100, Math.max(1, query.limit ?? 10));
        const filter: FilterQuery<INurse> = {};
        if (query.status) filter.status = query.status;
        if (query.search?.trim()) filter.$or = [
            { full_name: { $regex: query.search.trim(), $options: 'i' } },
            { license_number: { $regex: query.search.trim(), $options: 'i' } },
            { specialty: { $regex: query.search.trim(), $options: 'i' } },
        ];
        const [data, count] = await Promise.all([
            Nurse.find(filter).populate({ path: 'qualified_service_ids', select: 'name status category_id' })
                .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).exec(),
            Nurse.countDocuments(filter).exec(),
        ]);
        return { data, count };
    }
    public async create(input: Omit<Partial<INurse>, 'user_id' | 'qualified_service_ids'> & { user_id: string; qualified_service_ids: string[] }, actor: NurseWriteActor) {
        if(input.profile_photo)throw new DomainError('أنشئ ملف الممرض ثم ارفع صورته لغرضه المحدد',422,'UPLOAD_TARGET_NOT_FOUND');
        if (!mongoose.Types.ObjectId.isValid(input.user_id)) throw new DomainError('معرف المستخدم غير صالح', 400);
        const [user, duplicate] = await Promise.all([User.findById(input.user_id).exec(), Nurse.findOne({ user_id: input.user_id }).exec()]);
        if (!user) throw new DomainError('المستخدم غير موجود', 404);
        if (user.role !== IUserRoleEnum.NURSE) throw new DomainError('يجب أن يكون دور المستخدم ممرضاً', 422);
        if (duplicate) throw new DomainError('هذا المستخدم مسجل كممرض مسبقاً', 409);
        const serviceIds = ids(input.qualified_service_ids);
        if (await HomeCareService.countDocuments({ _id: { $in: serviceIds } }).exec() !== serviceIds.length) {
            throw new DomainError('إحدى خدمات الرعاية المنزلية غير موجودة', 422);
        }
        const nurse = await Nurse.create({ ...input, user_id: new mongoose.Types.ObjectId(input.user_id), qualified_service_ids: serviceIds });
        if (nurse.status !== INurseStatusEnum.ACTIVE) await sessionService.revokeAll(String(nurse.user_id), { reasonCode: 'NURSE_STATUS_DISABLED' });
        await this.audit('POST', IActivityLogActionEnum.CREATE, nurse, null, input, actor);
        return nurse;
    }
    public async update(id: string, input: Omit<Partial<INurse>, 'qualified_service_ids'> & { qualified_service_ids?: string[] }, actor: NurseWriteActor) {
        const current = await this.getById(id);
        if (!current) throw new DomainError('الممرض غير موجود', 404);
        const media=input.profile_photo?await uploadPolicyService.requireReadyReference(input.profile_photo,UploadPurposeEnum.NURSE_PROFILE_PHOTO,'NURSE',id):null;
        const payload: Record<string, unknown> = { ...input };
        if (input.qualified_service_ids) {
            const serviceIds = ids(input.qualified_service_ids);
            if (await HomeCareService.countDocuments({ _id: { $in: serviceIds } }).exec() !== serviceIds.length) {
                throw new DomainError('إحدى خدمات الرعاية المنزلية غير موجودة', 422);
            }
            payload.qualified_service_ids = serviceIds;
        }
        if (input.status !== undefined && input.status !== INurseStatusEnum.ACTIVE && input.status !== current.status) {
            await sessionService.revokeAll(String(current.user_id), { reasonCode: 'NURSE_STATUS_DISABLED' });
        }
        const updated = await Nurse.findByIdAndUpdate(id, { $set: payload }, { returnDocument: 'after', runValidators: true }).exec();
        if (!updated) throw new DomainError('الممرض غير موجود', 404);
        if(input.profile_photo!==undefined)await uploadPolicyService.finalizeReplacement(media,current.profile_photo,id,'profile_photo');
        await this.audit('PATCH', IActivityLogActionEnum.UPDATE, updated, current, input, actor);
        return await this.getById(id) ?? updated;
    }
    private async audit(method: string, action: string, doc: NurseDocument, old: NurseDocument | null, body: unknown, actor: NurseWriteActor) {
        try { await ActivityLogService.logActivity({ user_id: actor.user_id, user_name: `admin_${actor.user_id}`, user_type: 'admin', method, endpoint: actor.endpoint, action, collection_name: 'nurses', document_id: String(doc._id), old_data: old?.toObject?.() ?? old, new_data: doc.toObject?.() ?? doc, request_body: body, source: IActivityLogSourceEnum.DASHBOARD }); } catch {}
    }
}
export default new NurseService();
