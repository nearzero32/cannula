import mongoose, { type FilterQuery } from 'mongoose';
import HomeCareRequest, { type HomeCareRequestDocument } from '../models/home-care-request.model';
import HomeCareRequestCounter from '../models/home-care-request-counter.model';
import homeCareServiceService from './home-care-service.service';
import patientChildService from './patient-child.service';
import ActivityLogService from './activity-log.service';
import homeCareRequestHistoryService from './home-care-request-history.service';
import { HomeCareHistoryActorTypeEnum, HomeCareHistoryEventEnum } from '../interfaces/home-care-request-history.interface';
import { PatientChildStatusEnum } from '../interfaces/patient-child.interface';
import {
    IHomeCareRequestCancelledByTypeEnum,
    IHomeCareDispatchModeEnum,
    IHomeCareDispatchStatusEnum,
    IHomeCareRequestStatusEnum,
    type IHomeCareRequest,
    type IHomeCareRequestStatus,
} from '../interfaces/home-care-request.interface';
import { IActivityLogActionEnum, IActivityLogSourceEnum } from '../interfaces/activity-log.interface';
import { DomainError } from './domain-error';
import {
    normalizeOptionalRequestText,
    validateHomeCareRequestAddress,
    validatePreferredTime,
    validateRequestedDate,
    type HomeCareRequestAddressInput,
} from './home-care-request.validation';
import { localDateTimeToUtc, toBaghdadLocal } from './appointment-time.service';

export const HOME_CARE_REQUEST_MIN_LEAD_MINUTES = 30;

export interface HomeCareRequestCreateInput {
    service_id: string;
    child_id?: string | null;
    requested_date: string;
    preferred_time: string;
    address: HomeCareRequestAddressInput;
    notes?: string | null;
}

export interface HomeCareRequestListQuery {
    page?: number;
    limit?: number;
    status?: IHomeCareRequestStatus;
}

export interface HomeCareRequestDashboardListQuery extends HomeCareRequestListQuery {
    service_id?: string;
    category_id?: string;
    patient_id?: string;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
}

export interface HomeCareRequestActor {
    user_id: string;
    user_name?: string;
    user_type: 'patient' | 'admin';
    endpoint: string;
    source: 'mobile' | 'dashboard';
}

export const HOME_CARE_REQUEST_TRANSITIONS: Record<
    IHomeCareRequestStatus,
    readonly IHomeCareRequestStatus[]
> = {
    [IHomeCareRequestStatusEnum.PENDING]: [
        IHomeCareRequestStatusEnum.CONFIRMED,
        IHomeCareRequestStatusEnum.CANCELLED,
        IHomeCareRequestStatusEnum.REJECTED,
    ],
    [IHomeCareRequestStatusEnum.CONFIRMED]: [
        IHomeCareRequestStatusEnum.CANCELLED,
        IHomeCareRequestStatusEnum.REJECTED,
    ],
    [IHomeCareRequestStatusEnum.ASSIGNED]: [IHomeCareRequestStatusEnum.CANCELLED],
    [IHomeCareRequestStatusEnum.ON_THE_WAY]: [IHomeCareRequestStatusEnum.CANCELLED],
    [IHomeCareRequestStatusEnum.ARRIVED]: [IHomeCareRequestStatusEnum.CANCELLED],
    [IHomeCareRequestStatusEnum.IN_PROGRESS]: [IHomeCareRequestStatusEnum.CANCELLED],
    [IHomeCareRequestStatusEnum.COMPLETED]: [],
    [IHomeCareRequestStatusEnum.CANCELLED]: [],
    [IHomeCareRequestStatusEnum.REJECTED]: [],
};

export function assertHomeCareRequestTransition(
    current: IHomeCareRequestStatus,
    next: IHomeCareRequestStatus
): void {
    if (!HOME_CARE_REQUEST_TRANSITIONS[current].includes(next)) {
        throw new DomainError('انتقال حالة الطلب غير مسموح', 409);
    }
}

export async function nextHomeCareRequestNumber(now = new Date()): Promise<string> {
    const year = now.getUTCFullYear();
    const counter = await HomeCareRequestCounter.findOneAndUpdate(
        { _id: `home_care_request:${year}` },
        { $inc: { sequence: 1 } },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    ).exec();
    if (!counter) throw new Error('Failed to allocate a Home Care request number');
    return `HC-${year}-${String(counter.sequence).padStart(6, '0')}`;
}

function escapedRegex(value: string): RegExp {
    return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}

function isRequestNumberDuplicate(error: unknown): boolean {
    if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 11000) {
        return false;
    }
    const mongoError = error as { keyPattern?: Record<string, unknown>; message?: string };
    return mongoError.keyPattern?.request_number === 1 ||
        Boolean(mongoError.message?.includes('request_number'));
}

function normalizedFilterDate(value: string, endOfDay: boolean): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new DomainError('التاريخ غير صالح', 400);
    const suffix = endOfDay ? 'T23:59:59.999Z' : 'T00:00:00.000Z';
    const date = new Date(`${value}${suffix}`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
        throw new DomainError('التاريخ غير صالح', 400);
    }
    return date;
}

function withSafePopulation(query: any) {
    return query
        .populate({ path: 'patient_id', select: 'full_name phone profile_photo' })
        .populate({ path: 'child_id', select: 'full_name date_of_birth status' })
        .populate({ path: 'dispatch.nurse_id', select: 'full_name profile_photo license_verified status user_id' });
}

export class HomeCareRequestService {
    public async createForPatient(
        patientId: mongoose.Types.ObjectId,
        input: HomeCareRequestCreateInput,
        actor: HomeCareRequestActor
    ): Promise<HomeCareRequestDocument> {
        if (!mongoose.Types.ObjectId.isValid(input.service_id)) {
            throw new DomainError('معرف الخدمة غير صالح', 400);
        }
        const service = await homeCareServiceService.getActiveById(input.service_id);
        if (!service) throw new DomainError('الخدمة غير موجودة أو غير متاحة', 404);

        let childId: mongoose.Types.ObjectId | null = null;
        if (input.child_id !== null && input.child_id !== undefined) {
            if (!mongoose.Types.ObjectId.isValid(input.child_id)) {
                throw new DomainError('معرف الطفل غير صالح', 400);
            }
            const child = await patientChildService.requireOwnedChild(patientId, input.child_id);
            if (child.status !== PatientChildStatusEnum.ACTIVE) {
                throw new DomainError('لا يمكن طلب الخدمة لطفل غير فعال', 422);
            }
            childId = new mongoose.Types.ObjectId(child._id.toString());
        }

        const now = new Date();
        const requestedDate = validateRequestedDate(input.requested_date, now);
        const preferredTime = validatePreferredTime(input.preferred_time);
        const requestedInstant = localDateTimeToUtc(input.requested_date, preferredTime);
        if (toBaghdadLocal(now).date === input.requested_date && requestedInstant.getTime() < now.getTime() + HOME_CARE_REQUEST_MIN_LEAD_MINUTES * 60_000)
            throw new DomainError('وقت الطلب يجب أن يكون بعد 30 دقيقة على الأقل', 422, 'HOME_CARE_REQUEST_LEAD_TIME');
        const address = validateHomeCareRequestAddress(input.address);
        const notes = normalizeOptionalRequestText(input.notes, 2000, 'الملاحظات طويلة جداً');
        const basePayload: Omit<Partial<IHomeCareRequest>, 'request_number'> = {
            patient_id: patientId,
            child_id: childId,
            category_id: new mongoose.Types.ObjectId(service.category_id.toString()),
            service_id: new mongoose.Types.ObjectId(service._id.toString()),
            service_name: service.name,
            service_price: service.price,
            service_duration_min: service.duration_min ?? null,
            service_duration_max: service.duration_max ?? null,
            requested_date: requestedDate,
            preferred_time: preferredTime,
            address,
            notes,
            status: IHomeCareRequestStatusEnum.PENDING,
            dispatch: {
                status: IHomeCareDispatchStatusEnum.OPEN,
                mode: IHomeCareDispatchModeEnum.OPEN_POOL,
                nurse_id: null,
                assigned_at: null,
                assigned_by_user_id: null,
                version: 0,
            },
            internal_notes: null,
            cancelled_at: null,
            cancelled_by: null,
            cancellation_reason: null,
        };

        let request: HomeCareRequestDocument | null = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
                request = await HomeCareRequest.create({
                    ...basePayload,
                    request_number: await nextHomeCareRequestNumber(),
                });
                break;
            } catch (error) {
                if (!isRequestNumberDuplicate(error) || attempt === 2) throw error;
            }
        }
        if (!request) throw new Error('Failed to create Home Care request');
        await homeCareRequestHistoryService.append({
            request_id: new mongoose.Types.ObjectId(String(request._id)),
            request_number: request.request_number,
            event_type: HomeCareHistoryEventEnum.REQUEST_CREATED,
            actor: { type: HomeCareHistoryActorTypeEnum.PATIENT, user_id: new mongoose.Types.ObjectId(actor.user_id), nurse_id: null },
            from_status: null, to_status: IHomeCareRequestStatusEnum.PENDING,
            from_nurse_id: null, to_nurse_id: null,
            dispatch_mode: IHomeCareDispatchModeEnum.OPEN_POOL, reason: null, metadata: null,
        });
        await this.logWrite('POST', IActivityLogActionEnum.CREATE, request, null, input, actor);
        return await this.getForPatient(patientId, request._id.toString()) ?? request;
    }

    public async listForPatient(
        patientId: mongoose.Types.ObjectId,
        query: HomeCareRequestListQuery
    ): Promise<{ data: HomeCareRequestDocument[]; count: number }> {
        const page = Math.max(1, query.page ?? 1);
        const limit = Math.min(100, Math.max(1, query.limit ?? 10));
        const filter: FilterQuery<IHomeCareRequest> = { patient_id: patientId };
        if (query.status) filter.status = query.status;
        const [data, count] = await Promise.all([
            withSafePopulation(HomeCareRequest.find(filter))
                .sort({ createdAt: -1, _id: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .exec(),
            HomeCareRequest.countDocuments(filter).exec(),
        ]);
        return { data, count };
    }

    public async getForPatient(
        patientId: mongoose.Types.ObjectId,
        requestId: string
    ): Promise<HomeCareRequestDocument | null> {
        if (!mongoose.Types.ObjectId.isValid(requestId)) return null;
        return withSafePopulation(HomeCareRequest.findOne({
            _id: requestId,
            patient_id: patientId,
        })).exec();
    }

    public async cancelForPatient(
        patientId: mongoose.Types.ObjectId,
        requestId: string,
        reason: string | null | undefined,
        actor: HomeCareRequestActor
    ): Promise<HomeCareRequestDocument> {
        const current = await this.getForPatient(patientId, requestId);
        if (!current) throw new DomainError('الطلب غير موجود', 404);
        if (![IHomeCareRequestStatusEnum.PENDING, IHomeCareRequestStatusEnum.CONFIRMED]
            .includes(current.status as 'pending' | 'confirmed')) {
            throw new DomainError('لا يمكنك إلغاء هذا الطلب في حالته الحالية', 409);
        }
        const cancellationReason = normalizeOptionalRequestText(
            reason,
            1000,
            'سبب الإلغاء طويل جداً'
        );
        const updated = await HomeCareRequest.findOneAndUpdate(
            { _id: current._id, patient_id: patientId, status: current.status },
            {
                $set: {
                    status: IHomeCareRequestStatusEnum.CANCELLED,
                    cancelled_at: new Date(),
                    cancelled_by: {
                        id: new mongoose.Types.ObjectId(actor.user_id),
                        type: IHomeCareRequestCancelledByTypeEnum.PATIENT,
                    },
                    cancellation_reason: cancellationReason,
                    'dispatch.status': IHomeCareDispatchStatusEnum.CLOSED,
                },
                $inc: { 'dispatch.version': 1 },
            },
            { returnDocument: 'after', runValidators: true }
        ).exec();
        if (!updated) throw new DomainError('لا يمكنك إلغاء هذا الطلب في حالته الحالية', 409);
        await this.appendMutationHistory(updated, HomeCareHistoryEventEnum.REQUEST_CANCELLED, actor, current.status, updated.status, cancellationReason);
        await this.logWrite('PATCH', IActivityLogActionEnum.UPDATE, updated, current, { reason }, actor);
        return await this.getForPatient(patientId, updated._id.toString()) ?? updated;
    }

    public async listForDashboard(
        query: HomeCareRequestDashboardListQuery
    ): Promise<{ data: HomeCareRequestDocument[]; count: number }> {
        const page = Math.max(1, query.page ?? 1);
        const limit = Math.min(100, Math.max(1, query.limit ?? 10));
        const filter: FilterQuery<IHomeCareRequest> = {};
        if (query.status) filter.status = query.status;
        for (const [input, field] of [
            [query.service_id, 'service_id'],
            [query.category_id, 'category_id'],
            [query.patient_id, 'patient_id'],
        ] as const) {
            if (input) {
                if (!mongoose.Types.ObjectId.isValid(input)) throw new DomainError('المعرف غير صالح', 400);
                (filter as Record<string, unknown>)[field] = new mongoose.Types.ObjectId(input);
            }
        }
        if (query.dateFrom || query.dateTo) {
            const dateFilter: Record<string, Date> = {};
            if (query.dateFrom) dateFilter.$gte = normalizedFilterDate(query.dateFrom, false);
            if (query.dateTo) dateFilter.$lte = normalizedFilterDate(query.dateTo, true);
            filter.requested_date = dateFilter;
        }
        if (query.search?.trim()) {
            const search = escapedRegex(query.search.trim());
            filter.$or = [
                { request_number: search },
                { service_name: search },
                { 'address.address_text': search },
            ];
        }
        const [data, count] = await Promise.all([
            withSafePopulation(HomeCareRequest.find(filter))
                .sort({ createdAt: -1, _id: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .exec(),
            HomeCareRequest.countDocuments(filter).exec(),
        ]);
        return { data, count };
    }

    public async getForDashboard(requestId: string): Promise<HomeCareRequestDocument | null> {
        if (!mongoose.Types.ObjectId.isValid(requestId)) return null;
        return withSafePopulation(HomeCareRequest.findById(requestId)).exec();
    }

    public async updateStatus(
        requestId: string,
        status: IHomeCareRequestStatus,
        actor: HomeCareRequestActor
    ): Promise<HomeCareRequestDocument> {
        const current = await this.getForDashboard(requestId);
        if (!current) throw new DomainError('الطلب غير موجود', 404);
        if (status !== IHomeCareRequestStatusEnum.CONFIRMED || current.status !== IHomeCareRequestStatusEnum.PENDING)
            throw new DomainError('تأكيد الطلب فقط متاح من خلال هذا الإجراء', 409, 'HOME_CARE_STATUS_ACTION_FORBIDDEN');
        assertHomeCareRequestTransition(current.status, status);
        const set: Record<string, unknown> = { status };
        const updated = await HomeCareRequest.findOneAndUpdate(
            { _id: current._id, status: current.status },
            { $set: set, $inc: { 'dispatch.version': 1 } },
            { returnDocument: 'after', runValidators: true }
        ).exec();
        if (!updated) throw new DomainError('تم تحديث الطلب بواسطة مستخدم آخر، يرجى المحاولة مجدداً', 409);
        await this.appendMutationHistory(updated, HomeCareHistoryEventEnum.STATUS_CHANGED, actor, current.status, updated.status, null);
        await this.logWrite('PATCH', IActivityLogActionEnum.UPDATE, updated, current, { status }, actor);
        return await this.getForDashboard(updated._id.toString()) ?? updated;
    }

    public async cancelForAdmin(
        requestId: string,
        reason: string | null | undefined,
        actor: HomeCareRequestActor
    ): Promise<HomeCareRequestDocument> {
        const current = await this.getForDashboard(requestId);
        if (!current) throw new DomainError('الطلب غير موجود', 404);
        assertHomeCareRequestTransition(current.status, IHomeCareRequestStatusEnum.CANCELLED);
        const cancellationReason = normalizeOptionalRequestText(reason, 1000, 'سبب الإلغاء طويل جداً');
        if ([IHomeCareRequestStatusEnum.ASSIGNED, IHomeCareRequestStatusEnum.ON_THE_WAY, IHomeCareRequestStatusEnum.ARRIVED, IHomeCareRequestStatusEnum.IN_PROGRESS].includes(current.status as any) && !cancellationReason) {
            throw new DomainError('سبب الإلغاء مطلوب', 400);
        }
        const cancelFilter: Record<string, unknown> = { _id: current._id, status: current.status };
        if (current.dispatch?.version !== undefined) cancelFilter['dispatch.version'] = current.dispatch.version;
        const updated = await HomeCareRequest.findOneAndUpdate(
            cancelFilter,
            {
                $set: {
                    status: IHomeCareRequestStatusEnum.CANCELLED,
                    cancelled_at: new Date(),
                    cancelled_by: {
                        id: new mongoose.Types.ObjectId(actor.user_id),
                        type: IHomeCareRequestCancelledByTypeEnum.ADMIN,
                    },
                    cancellation_reason: cancellationReason,
                    'dispatch.status': IHomeCareDispatchStatusEnum.CLOSED,
                },
                $inc: { 'dispatch.version': 1 },
            },
            { returnDocument: 'after', runValidators: true }
        ).exec();
        if (!updated) throw new DomainError('تم تحديث الطلب بواسطة مستخدم آخر، يرجى المحاولة مجدداً', 409);
        await this.appendMutationHistory(updated, HomeCareHistoryEventEnum.REQUEST_CANCELLED, actor, current.status, updated.status, cancellationReason);
        await this.logWrite('PATCH', IActivityLogActionEnum.UPDATE, updated, current, { reason }, actor);
        return await this.getForDashboard(updated._id.toString()) ?? updated;
    }

    public async rejectForAdmin(requestId: string, reason: string, actor: HomeCareRequestActor): Promise<HomeCareRequestDocument> {
        const current = await this.getForDashboard(requestId);
        if (!current) throw new DomainError('الطلب غير موجود', 404);
        const normalized = normalizeOptionalRequestText(reason, 1000, 'سبب الرفض طويل جداً');
        if (!normalized) throw new DomainError('سبب الرفض مطلوب', 400);
        const updated = await HomeCareRequest.findOneAndUpdate(
            { _id: current._id, status: { $in: [IHomeCareRequestStatusEnum.PENDING, IHomeCareRequestStatusEnum.CONFIRMED] }, 'dispatch.status': IHomeCareDispatchStatusEnum.OPEN, 'dispatch.nurse_id': null },
            { $set: { status: IHomeCareRequestStatusEnum.REJECTED, 'dispatch.status': IHomeCareDispatchStatusEnum.CLOSED }, $inc: { 'dispatch.version': 1 } },
            { returnDocument: 'after', runValidators: true }
        ).exec();
        if (!updated) throw new DomainError('لا يمكن رفض هذا الطلب في حالته الحالية', 409);
        await this.appendMutationHistory(updated, HomeCareHistoryEventEnum.REQUEST_REJECTED, actor, current.status, updated.status, normalized);
        await this.logWrite('PATCH', IActivityLogActionEnum.UPDATE, updated, current, { reason: normalized }, actor);
        return await this.getForDashboard(updated._id.toString()) ?? updated;
    }

    public async updateInternalNote(
        requestId: string,
        internalNotes: string | null | undefined,
        actor: HomeCareRequestActor
    ): Promise<HomeCareRequestDocument> {
        const current = await this.getForDashboard(requestId);
        if (!current) throw new DomainError('الطلب غير موجود', 404);
        const normalized = normalizeOptionalRequestText(
            internalNotes,
            3000,
            'الملاحظة الداخلية طويلة جداً'
        );
        const updated = await HomeCareRequest.findByIdAndUpdate(
            current._id,
            { $set: { internal_notes: normalized } },
            { returnDocument: 'after', runValidators: true }
        ).exec();
        if (!updated) throw new DomainError('الطلب غير موجود', 404);
        await this.logWrite(
            'PATCH',
            IActivityLogActionEnum.UPDATE,
            updated,
            current,
            { internal_notes: normalized },
            actor
        );
        return await this.getForDashboard(updated._id.toString()) ?? updated;
    }

    private async logWrite(
        method: string,
        action: string,
        document: HomeCareRequestDocument,
        oldDocument: HomeCareRequestDocument | null,
        requestBody: unknown,
        actor: HomeCareRequestActor
    ): Promise<void> {
        try {
            await ActivityLogService.logActivity({
                user_id: actor.user_id,
                user_name: actor.user_name ?? `${actor.user_type}_${actor.user_id}`,
                user_type: actor.user_type,
                method,
                endpoint: actor.endpoint,
                action,
                collection_name: 'home_care_requests',
                document_id: document._id.toString(),
                old_data: oldDocument?.toObject?.() ?? oldDocument,
                new_data: document.toObject?.() ?? document,
                changed_fields: oldDocument ? ['status', 'internal_notes', 'cancellation_reason'] : [],
                request_body: requestBody,
                response_status: method === 'POST' ? 201 : 200,
                source: actor.source === 'mobile'
                    ? IActivityLogSourceEnum.MOBILE
                    : IActivityLogSourceEnum.DASHBOARD,
            });
        } catch {
            // Activity logging is best-effort across the existing services.
        }
    }

    private async appendMutationHistory(
        request: HomeCareRequestDocument,
        event_type: (typeof HomeCareHistoryEventEnum)[keyof typeof HomeCareHistoryEventEnum],
        actor: HomeCareRequestActor,
        from_status: string,
        to_status: string,
        reason: string | null
    ): Promise<void> {
        const nurseValue = request.dispatch?.nurse_id as unknown as { _id?: unknown } | null | undefined;
        const nurseId = nurseValue ? new mongoose.Types.ObjectId(String(nurseValue._id ?? nurseValue)) : null;
        await homeCareRequestHistoryService.append({
            request_id: new mongoose.Types.ObjectId(String(request._id)), request_number: request.request_number,
            event_type,
            actor: { type: actor.user_type === 'patient' ? HomeCareHistoryActorTypeEnum.PATIENT : HomeCareHistoryActorTypeEnum.ADMIN, user_id: new mongoose.Types.ObjectId(actor.user_id), nurse_id: null },
            from_status, to_status, from_nurse_id: nurseId, to_nurse_id: nurseId,
            dispatch_mode: request.dispatch?.mode ?? null, reason, metadata: null,
        });
    }
}

export default new HomeCareRequestService();
