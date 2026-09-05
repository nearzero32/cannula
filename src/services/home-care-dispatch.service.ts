import mongoose, { type FilterQuery } from 'mongoose';
import HomeCareRequest, { type HomeCareRequestDocument } from '../models/home-care-request.model';
import Nurse, { type NurseDocument } from '../models/nurse.model';
import nurseService from './nurse.service';
import historyService from './home-care-request-history.service';
import ActivityLogService from './activity-log.service';
import { DomainError } from './domain-error';
import {
    IHomeCareDispatchModeEnum, IHomeCareDispatchStatusEnum, IHomeCareRequestStatusEnum,
    type IHomeCareRequest, type IHomeCareRequestStatus,
} from '../interfaces/home-care-request.interface';
import { HomeCareHistoryActorTypeEnum, HomeCareHistoryEventEnum, type HomeCareHistoryEvent } from '../interfaces/home-care-request-history.interface';
import { IActivityLogActionEnum, IActivityLogSourceEnum } from '../interfaces/activity-log.interface';
import { normalizeOptionalRequestText } from './home-care-request.validation';
import { homeCareBaghdadDateRange } from './home-care-date.service';
import { runHomeCareTransaction } from './home-care-transaction.service';
import domainNotificationService, { type HomeCareDomainNotifier } from './domain-notification.service';

export interface DispatchActor {
    user_id: string;
    user_type: 'nurse' | 'admin';
    nurse_id?: string;
    endpoint: string;
}
export interface DispatchListQuery { page?: number; limit?: number; status?: IHomeCareRequestStatus; service_id?: string; dateFrom?: string; dateTo?: string }

const CLAIMABLE = [IHomeCareRequestStatusEnum.PENDING, IHomeCareRequestStatusEnum.CONFIRMED];
const ACTIVE_ASSIGNMENTS = [IHomeCareRequestStatusEnum.ASSIGNED, IHomeCareRequestStatusEnum.ON_THE_WAY, IHomeCareRequestStatusEnum.ARRIVED, IHomeCareRequestStatusEnum.IN_PROGRESS];

function requestQuery() {
    return (query: any) => query
        .populate({ path: 'patient_id', select: 'full_name phone profile_photo' })
        .populate({ path: 'child_id', select: 'full_name date_of_birth status' })
        .populate({ path: 'dispatch.nurse_id', select: 'full_name profile_photo license_verified status user_id' });
}
const populate = requestQuery();

function openDispatchFilter(): Record<string, unknown> {
    return {
        $and: [
            { $or: [{ 'dispatch.status': IHomeCareDispatchStatusEnum.OPEN }, { 'dispatch.status': { $exists: false } }] },
            { $or: [{ 'dispatch.nurse_id': null }, { 'dispatch.nurse_id': { $exists: false } }] },
        ],
    };
}

function dateFilter(query: DispatchListQuery): Record<string, Date> | undefined {
    return homeCareBaghdadDateRange(query.dateFrom, query.dateTo);
}

export class HomeCareDispatchService {
    constructor(private readonly notifications: HomeCareDomainNotifier = domainNotificationService) {}

    public async listAvailable(userId: string, query: DispatchListQuery) {
        const nurse = await nurseService.requireActiveByUserId(userId);
        const qualified = nurse.qualified_service_ids.map(item => new mongoose.Types.ObjectId(String((item as any)._id ?? item)));
        if (query.service_id && !mongoose.Types.ObjectId.isValid(query.service_id)) throw new DomainError('معرف الخدمة غير صالح', 400);
        if (query.service_id && !qualified.some(id => String(id) === query.service_id)) throw new DomainError('أنت غير مؤهل لتنفيذ هذه الخدمة', 422);
        const page = Math.max(1, query.page ?? 1), limit = Math.min(100, Math.max(1, query.limit ?? 10));
        const filter: FilterQuery<IHomeCareRequest> = {
            status: { $in: CLAIMABLE }, service_id: query.service_id ? new mongoose.Types.ObjectId(query.service_id) : { $in: qualified },
            ...openDispatchFilter(),
        };
        const dates = dateFilter(query); if (dates) filter.requested_date = dates;
        const [data, count] = await Promise.all([
            populate(HomeCareRequest.find(filter)).sort({ requested_date: 1, preferred_time: 1, createdAt: 1 }).skip((page - 1) * limit).limit(limit).exec(),
            HomeCareRequest.countDocuments(filter).exec(),
        ]);
        return { data, count };
    }

    public async listMine(userId: string, query: DispatchListQuery) {
        const nurse = await nurseService.requireActiveByUserId(userId);
        const page = Math.max(1, query.page ?? 1), limit = Math.min(100, Math.max(1, query.limit ?? 10));
        const filter: FilterQuery<IHomeCareRequest> = { 'dispatch.nurse_id': nurse._id };
        if (query.status) filter.status = query.status;
        const dates = dateFilter(query); if (dates) filter.requested_date = dates;
        const [data, count] = await Promise.all([
            populate(HomeCareRequest.find(filter)).sort({ requested_date: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).exec(),
            HomeCareRequest.countDocuments(filter).exec(),
        ]);
        return { data, count };
    }

    public async getMine(userId: string, requestId: string) {
        if (!mongoose.Types.ObjectId.isValid(requestId)) return null;
        const nurse = await nurseService.requireActiveByUserId(userId);
        return populate(HomeCareRequest.findOne({ _id: requestId, 'dispatch.nurse_id': nurse._id })).exec();
    }

    public async claim(userId: string, requestId: string, actor: DispatchActor): Promise<HomeCareRequestDocument> {
        if (!mongoose.Types.ObjectId.isValid(requestId)) throw new DomainError('معرف الطلب غير صالح', 400);
        const nurse = await nurseService.requireActiveByUserId(userId);
        const updated = await runHomeCareTransaction(async session => {
            const snapshot = await HomeCareRequest.findById(requestId).select('service_id status request_number dispatch').session(session).exec();
            if (!snapshot) throw new DomainError('الطلب غير موجود', 404);
            if (!nurse.qualified_service_ids.some(id => String((id as any)._id ?? id) === String(snapshot.service_id))) throw new DomainError('أنت غير مؤهل لتنفيذ هذه الخدمة', 422);
            const result = await HomeCareRequest.findOneAndUpdate(
                { _id: snapshot._id, status: { $in: CLAIMABLE }, ...openDispatchFilter() },
                { $set: { status: IHomeCareRequestStatusEnum.ASSIGNED, 'dispatch.status': IHomeCareDispatchStatusEnum.CLAIMED, 'dispatch.mode': IHomeCareDispatchModeEnum.OPEN_POOL, 'dispatch.nurse_id': nurse._id, 'dispatch.assigned_at': new Date(), 'dispatch.assigned_by_user_id': null }, $inc: { 'dispatch.version': 1 } },
                { returnDocument: 'after', runValidators: true, session }
            ).exec();
            if (!result) throw new DomainError('تم استلام هذا الطلب مسبقاً', 409);
            await historyService.append({ request_id: new mongoose.Types.ObjectId(String(result._id)), request_number: result.request_number, event_type: HomeCareHistoryEventEnum.CLAIMED_BY_NURSE, actor: { type: HomeCareHistoryActorTypeEnum.NURSE, user_id: new mongoose.Types.ObjectId(actor.user_id), nurse_id: new mongoose.Types.ObjectId(String(nurse._id)) }, from_status: snapshot.status, to_status: result.status, from_nurse_id: null, to_nurse_id: new mongoose.Types.ObjectId(String(nurse._id)), dispatch_mode: IHomeCareDispatchModeEnum.OPEN_POOL, reason: null, metadata: null }, { session, critical: true });
            await this.notifications.homeCare(result,'assigned',[],session);
            return result;
        });
        try { await ActivityLogService.logActivity({ user_id: actor.user_id, user_name: `${actor.user_type}_${actor.user_id}`, user_type: actor.user_type, method: 'PATCH', endpoint: actor.endpoint, action: IActivityLogActionEnum.UPDATE, collection_name: 'home_care_requests', document_id: String(updated._id), new_data: updated.toObject?.() ?? updated, changed_fields: ['status', 'dispatch'], request_body: { event: HomeCareHistoryEventEnum.CLAIMED_BY_NURSE }, source: IActivityLogSourceEnum.DASHBOARD }); } catch {}
        return await populate(HomeCareRequest.findById(updated._id)).exec() ?? updated;
    }

    public async transition(userId: string, requestId: string, expected: IHomeCareRequestStatus, next: IHomeCareRequestStatus, actor: DispatchActor) {
        if (!mongoose.Types.ObjectId.isValid(requestId)) throw new DomainError('معرف الطلب غير صالح', 400);
        const allowed: Partial<Record<IHomeCareRequestStatus, IHomeCareRequestStatus>> = {
            [IHomeCareRequestStatusEnum.ASSIGNED]: IHomeCareRequestStatusEnum.ON_THE_WAY,
            [IHomeCareRequestStatusEnum.ON_THE_WAY]: IHomeCareRequestStatusEnum.ARRIVED,
            [IHomeCareRequestStatusEnum.ARRIVED]: IHomeCareRequestStatusEnum.IN_PROGRESS,
            [IHomeCareRequestStatusEnum.IN_PROGRESS]: IHomeCareRequestStatusEnum.COMPLETED,
        };
        if (allowed[expected] !== next) throw new DomainError('لا يمكنك تنفيذ هذا الإجراء في حالة الطلب الحالية', 409);
        const nurse = await nurseService.requireActiveByUserId(userId);
        const updated = await runHomeCareTransaction(async session => {
            const snapshot = await this.requestSnapshot(requestId, session);
            const result = await HomeCareRequest.findOneAndUpdate(
                { _id: snapshot._id, status: expected, 'dispatch.status': IHomeCareDispatchStatusEnum.CLAIMED, 'dispatch.nurse_id': nurse._id, 'dispatch.version': snapshot.dispatch.version },
                { $set: { status: next, ...(next === IHomeCareRequestStatusEnum.COMPLETED ? { 'dispatch.status': IHomeCareDispatchStatusEnum.CLOSED } : {}) }, $inc: { 'dispatch.version': 1 } },
                { returnDocument: 'after', runValidators: true, session }
            ).exec();
            if (!result) throw new DomainError('لا يمكنك تنفيذ هذا الإجراء في حالة الطلب الحالية', 409);
            await historyService.append({ request_id: new mongoose.Types.ObjectId(String(result._id)), request_number: result.request_number, event_type: next === IHomeCareRequestStatusEnum.COMPLETED ? HomeCareHistoryEventEnum.COMPLETED : HomeCareHistoryEventEnum.STATUS_CHANGED, actor: { type: HomeCareHistoryActorTypeEnum.NURSE, user_id: new mongoose.Types.ObjectId(actor.user_id), nurse_id: new mongoose.Types.ObjectId(String(nurse._id)) }, from_status: expected, to_status: next, from_nurse_id: new mongoose.Types.ObjectId(String(nurse._id)), to_nurse_id: new mongoose.Types.ObjectId(String(nurse._id)), dispatch_mode: result.dispatch.mode, reason: null, metadata: null }, { session, critical: true });
            await this.notifications.homeCare(result,next,[],session);
            return result;
        });
        try { await ActivityLogService.logActivity({ user_id: actor.user_id, user_name: `${actor.user_type}_${actor.user_id}`, user_type: actor.user_type, method: 'PATCH', endpoint: actor.endpoint, action: IActivityLogActionEnum.UPDATE, collection_name: 'home_care_requests', document_id: String(updated._id), new_data: updated.toObject?.() ?? updated, changed_fields: ['status', 'dispatch'], request_body: { event: next === IHomeCareRequestStatusEnum.COMPLETED ? HomeCareHistoryEventEnum.COMPLETED : HomeCareHistoryEventEnum.STATUS_CHANGED }, source: IActivityLogSourceEnum.DASHBOARD }); } catch {}
        return await populate(HomeCareRequest.findById(updated._id)).exec() ?? updated;
    }

    public async assign(requestId: string, nurseId: string, actor: DispatchActor) {
        if (!mongoose.Types.ObjectId.isValid(requestId)) throw new DomainError('معرف الطلب غير صالح', 400);
        const updated = await runHomeCareTransaction(async session => {
            const snapshot = await HomeCareRequest.findById(requestId).session(session).exec();
            if (!snapshot) throw new DomainError('الطلب غير موجود', 404);
            const nurse = await nurseService.requireActiveQualified(nurseId, snapshot.service_id, session);
            const result = await HomeCareRequest.findOneAndUpdate(
                { _id: snapshot._id, status: { $in: CLAIMABLE }, 'dispatch.status': IHomeCareDispatchStatusEnum.OPEN, 'dispatch.nurse_id': null, 'dispatch.version': snapshot.dispatch.version },
                { $set: { status: IHomeCareRequestStatusEnum.ASSIGNED, 'dispatch.status': IHomeCareDispatchStatusEnum.CLAIMED, 'dispatch.mode': IHomeCareDispatchModeEnum.ADMIN_DIRECT, 'dispatch.nurse_id': nurse._id, 'dispatch.assigned_at': new Date(), 'dispatch.assigned_by_user_id': new mongoose.Types.ObjectId(actor.user_id) }, $inc: { 'dispatch.version': 1 } },
                { returnDocument: 'after', runValidators: true, session }
            ).exec();
            if (!result) throw new DomainError('تم استلام هذا الطلب مسبقاً', 409);
            await historyService.append({ request_id: new mongoose.Types.ObjectId(String(result._id)), request_number: result.request_number, event_type: HomeCareHistoryEventEnum.ASSIGNED_BY_ADMIN, actor: { type: HomeCareHistoryActorTypeEnum.ADMIN, user_id: new mongoose.Types.ObjectId(actor.user_id), nurse_id: null }, from_status: snapshot.status, to_status: result.status, from_nurse_id: null, to_nurse_id: new mongoose.Types.ObjectId(String(nurse._id)), dispatch_mode: IHomeCareDispatchModeEnum.ADMIN_DIRECT, reason: null, metadata: null }, { session, critical: true });
            await this.notifications.homeCare(result,'assigned',[nurse._id],session);
            return result;
        });
        try { await ActivityLogService.logActivity({ user_id: actor.user_id, user_name: `${actor.user_type}_${actor.user_id}`, user_type: actor.user_type, method: 'PATCH', endpoint: actor.endpoint, action: IActivityLogActionEnum.UPDATE, collection_name: 'home_care_requests', document_id: String(updated._id), new_data: updated.toObject?.() ?? updated, changed_fields: ['status', 'dispatch'], request_body: { event: HomeCareHistoryEventEnum.ASSIGNED_BY_ADMIN }, source: IActivityLogSourceEnum.DASHBOARD }); } catch {}
        return await populate(HomeCareRequest.findById(updated._id)).exec() ?? updated;
    }

    public async reassign(requestId: string, nurseId: string, reason: string | null | undefined, actor: DispatchActor) {
        const normalized = normalizeOptionalRequestText(reason, 1000, 'سبب إعادة التعيين طويل جداً');
        const updated = await runHomeCareTransaction(async session => {
            const snapshot = await this.requestSnapshot(requestId, session);
            if (!ACTIVE_ASSIGNMENTS.includes(snapshot.status as any) || !snapshot.dispatch?.nurse_id) throw new DomainError('لا يمكن إعادة تعيين الطلب في حالته الحالية', 409);
            if (snapshot.status !== IHomeCareRequestStatusEnum.ASSIGNED && !normalized) throw new DomainError('سبب إعادة التعيين مطلوب', 400);
            if (String(snapshot.dispatch.nurse_id) === nurseId) throw new DomainError('الممرض الجديد هو الممرض الحالي', 409);
            const nurse = await nurseService.requireActiveQualified(nurseId, snapshot.service_id, session);
            const result = await HomeCareRequest.findOneAndUpdate({ _id: snapshot._id, status: snapshot.status, 'dispatch.status': IHomeCareDispatchStatusEnum.CLAIMED, 'dispatch.nurse_id': snapshot.dispatch.nurse_id, 'dispatch.version': snapshot.dispatch.version }, { $set: { status: IHomeCareRequestStatusEnum.ASSIGNED, 'dispatch.mode': IHomeCareDispatchModeEnum.ADMIN_REASSIGN, 'dispatch.nurse_id': nurse._id, 'dispatch.assigned_at': new Date(), 'dispatch.assigned_by_user_id': new mongoose.Types.ObjectId(actor.user_id) }, $inc: { 'dispatch.version': 1 } }, { returnDocument: 'after', runValidators: true, session }).exec();
            if (!result) throw new DomainError('تم تحديث الطلب بواسطة مستخدم آخر، يرجى المحاولة مجدداً', 409);
            await historyService.append({ request_id: new mongoose.Types.ObjectId(String(result._id)), request_number: result.request_number, event_type: HomeCareHistoryEventEnum.REASSIGNED_BY_ADMIN, actor: { type: HomeCareHistoryActorTypeEnum.ADMIN, user_id: new mongoose.Types.ObjectId(actor.user_id), nurse_id: null }, from_status: snapshot.status, to_status: result.status, from_nurse_id: snapshot.dispatch.nurse_id, to_nurse_id: nurse._id, dispatch_mode: IHomeCareDispatchModeEnum.ADMIN_REASSIGN, reason: normalized, metadata: null }, { session, critical: true }); await this.notifications.homeCare(result,'reassigned',[nurse._id],session); return result;
        });
        try { await ActivityLogService.logActivity({ user_id: actor.user_id, user_name: `${actor.user_type}_${actor.user_id}`, user_type: actor.user_type, method: 'PATCH', endpoint: actor.endpoint, action: IActivityLogActionEnum.UPDATE, collection_name: 'home_care_requests', document_id: String(updated._id), new_data: updated.toObject?.() ?? updated, changed_fields: ['status', 'dispatch'], request_body: { event: HomeCareHistoryEventEnum.REASSIGNED_BY_ADMIN, reason: normalized }, source: IActivityLogSourceEnum.DASHBOARD }); } catch {}
        return await populate(HomeCareRequest.findById(updated._id)).exec() ?? updated;
    }

    public async unassign(requestId: string, reason: string, actor: DispatchActor) {
        const normalized = normalizeOptionalRequestText(reason, 1000, 'سبب إلغاء التعيين طويل جداً');
        if (!normalized) throw new DomainError('سبب إلغاء التعيين مطلوب', 400);
        const updated = await runHomeCareTransaction(async session => {
            const snapshot = await this.requestSnapshot(requestId, session);
            if (!ACTIVE_ASSIGNMENTS.includes(snapshot.status as any) || !snapshot.dispatch?.nurse_id) throw new DomainError('لا يمكن إلغاء تعيين الطلب في حالته الحالية', 409);
            const result = await HomeCareRequest.findOneAndUpdate({ _id: snapshot._id, status: snapshot.status, 'dispatch.status': IHomeCareDispatchStatusEnum.CLAIMED, 'dispatch.nurse_id': snapshot.dispatch.nurse_id, 'dispatch.version': snapshot.dispatch.version }, { $set: { status: IHomeCareRequestStatusEnum.CONFIRMED, 'dispatch.status': IHomeCareDispatchStatusEnum.OPEN, 'dispatch.mode': IHomeCareDispatchModeEnum.OPEN_POOL, 'dispatch.nurse_id': null, 'dispatch.assigned_at': null, 'dispatch.assigned_by_user_id': null }, $inc: { 'dispatch.version': 1 } }, { returnDocument: 'after', runValidators: true, session }).exec();
            if (!result) throw new DomainError('تم تحديث الطلب بواسطة مستخدم آخر، يرجى المحاولة مجدداً', 409);
            await historyService.append({ request_id: new mongoose.Types.ObjectId(String(result._id)), request_number: result.request_number, event_type: HomeCareHistoryEventEnum.UNASSIGNED_BY_ADMIN, actor: { type: HomeCareHistoryActorTypeEnum.ADMIN, user_id: new mongoose.Types.ObjectId(actor.user_id), nurse_id: null }, from_status: snapshot.status, to_status: result.status, from_nurse_id: snapshot.dispatch.nurse_id, to_nurse_id: null, dispatch_mode: IHomeCareDispatchModeEnum.OPEN_POOL, reason: normalized, metadata: null }, { session, critical: true }); await this.notifications.homeCare(result,'unassigned',[],session); return result;
        });
        try { await ActivityLogService.logActivity({ user_id: actor.user_id, user_name: `${actor.user_type}_${actor.user_id}`, user_type: actor.user_type, method: 'PATCH', endpoint: actor.endpoint, action: IActivityLogActionEnum.UPDATE, collection_name: 'home_care_requests', document_id: String(updated._id), new_data: updated.toObject?.() ?? updated, changed_fields: ['status', 'dispatch'], request_body: { event: HomeCareHistoryEventEnum.UNASSIGNED_BY_ADMIN, reason: normalized }, source: IActivityLogSourceEnum.DASHBOARD }); } catch {}
        return await populate(HomeCareRequest.findById(updated._id)).exec() ?? updated;
    }

    public async reopen(requestId: string, reason: string, actor: DispatchActor) {
        const normalized = normalizeOptionalRequestText(reason, 1000, 'سبب إعادة الفتح طويل جداً');
        if (!normalized) throw new DomainError('سبب إعادة فتح الطلب مطلوب', 400);
        const updated = await runHomeCareTransaction(async session => {
            const snapshot = await this.requestSnapshot(requestId, session);
            if (![IHomeCareRequestStatusEnum.CANCELLED, IHomeCareRequestStatusEnum.REJECTED].includes(snapshot.status as any)) throw new DomainError('لا يمكن إعادة فتح الطلب في حالته الحالية', 409);
            const result = await HomeCareRequest.findOneAndUpdate({ _id: snapshot._id, status: snapshot.status, 'dispatch.version': snapshot.dispatch.version }, { $set: { status: IHomeCareRequestStatusEnum.CONFIRMED, 'dispatch.status': IHomeCareDispatchStatusEnum.OPEN, 'dispatch.mode': IHomeCareDispatchModeEnum.OPEN_POOL, 'dispatch.nurse_id': null, 'dispatch.assigned_at': null, 'dispatch.assigned_by_user_id': null, cancelled_at: null, cancelled_by: null, cancellation_reason: null }, $inc: { 'dispatch.version': 1 } }, { returnDocument: 'after', runValidators: true, session }).exec();
            if (!result) throw new DomainError('تم تحديث الطلب بواسطة مستخدم آخر، يرجى المحاولة مجدداً', 409);
            await historyService.append({ request_id: new mongoose.Types.ObjectId(String(result._id)), request_number: result.request_number, event_type: HomeCareHistoryEventEnum.REQUEST_REOPENED, actor: { type: HomeCareHistoryActorTypeEnum.ADMIN, user_id: new mongoose.Types.ObjectId(actor.user_id), nurse_id: null }, from_status: snapshot.status, to_status: result.status, from_nurse_id: snapshot.dispatch?.nurse_id ?? null, to_nurse_id: null, dispatch_mode: IHomeCareDispatchModeEnum.OPEN_POOL, reason: normalized, metadata: null }, { session, critical: true }); return result;
        });
        try { await ActivityLogService.logActivity({ user_id: actor.user_id, user_name: `${actor.user_type}_${actor.user_id}`, user_type: actor.user_type, method: 'PATCH', endpoint: actor.endpoint, action: IActivityLogActionEnum.UPDATE, collection_name: 'home_care_requests', document_id: String(updated._id), new_data: updated.toObject?.() ?? updated, changed_fields: ['status', 'dispatch'], request_body: { event: HomeCareHistoryEventEnum.REQUEST_REOPENED, reason: normalized }, source: IActivityLogSourceEnum.DASHBOARD }); } catch {}
        return await populate(HomeCareRequest.findById(updated._id)).exec() ?? updated;
    }

    private async requestSnapshot(requestId: string, session?: mongoose.ClientSession) {
        if (!mongoose.Types.ObjectId.isValid(requestId)) throw new DomainError('معرف الطلب غير صالح', 400);
        const request = await HomeCareRequest.findById(requestId).session(session ?? null).exec();
        if (!request) throw new DomainError('الطلب غير موجود', 404);
        return request;
    }

    private async record(request: HomeCareRequestDocument, event: HomeCareHistoryEvent, actor: DispatchActor, fromStatus: string | null, toStatus: string | null, fromNurse: string | null, toNurse: string | null, mode: string | null, reason: string | null = null) {
        await historyService.append({ request_id: new mongoose.Types.ObjectId(String(request._id)), request_number: request.request_number, event_type: event, actor: { type: actor.user_type === 'nurse' ? HomeCareHistoryActorTypeEnum.NURSE : HomeCareHistoryActorTypeEnum.ADMIN, user_id: new mongoose.Types.ObjectId(actor.user_id), nurse_id: actor.nurse_id ? new mongoose.Types.ObjectId(actor.nurse_id) : null }, from_status: fromStatus, to_status: toStatus, from_nurse_id: fromNurse ? new mongoose.Types.ObjectId(fromNurse) : null, to_nurse_id: toNurse ? new mongoose.Types.ObjectId(toNurse) : null, dispatch_mode: mode, reason, metadata: null });
        try { await ActivityLogService.logActivity({ user_id: actor.user_id, user_name: `${actor.user_type}_${actor.user_id}`, user_type: actor.user_type, method: 'PATCH', endpoint: actor.endpoint, action: IActivityLogActionEnum.UPDATE, collection_name: 'home_care_requests', document_id: String(request._id), new_data: request.toObject?.() ?? request, changed_fields: ['status', 'dispatch'], request_body: { event, reason }, source: IActivityLogSourceEnum.DASHBOARD }); } catch {}
    }
}

export default new HomeCareDispatchService();
