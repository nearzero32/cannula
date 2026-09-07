import mongoose, { type ClientSession } from 'mongoose';
import HomeCareAvailabilitySlot, { type HomeCareAvailabilitySlotDocument } from '../models/home-care-availability-slot.model';
import HomeCareService from '../models/home-care-service.model';
import homeCareServiceService from './home-care-service.service';
import { IHomeCareStatusEnum, type IHomeCareStatus } from '../interfaces/home-care.interface';
import { DomainError } from './domain-error';
import { validateRequestedDate } from './home-care-request.validation';
import { homeCareSlotMeetsLeadTime } from './home-care-date.service';
import ActivityLogService from './activity-log.service';
import { IActivityLogActionEnum, IActivityLogSourceEnum } from '../interfaces/activity-log.interface';

export const HOME_CARE_MAX_AVAILABILITY_SLOTS = 24;
export const HOME_CARE_SLOT_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
export const HOME_CARE_SLOT_SORT = { display_order: 1 as const, time: 1 as const, _id: 1 as const };
export type HomeCareSlotActor = { user_id: string; user_name?: string; user_type?: string; endpoint?: string; source?: string };

export function formatHomeCareAvailabilitySlot(slot: any) {
    return { _id: String(slot._id), service_id: String(slot.service_id), time: slot.time, status: slot.status, display_order: slot.display_order, created_by: slot.created_by ? String(slot.created_by) : null, createdAt: slot.createdAt instanceof Date ? slot.createdAt.toISOString() : slot.createdAt, updatedAt: slot.updatedAt instanceof Date ? slot.updatedAt.toISOString() : slot.updatedAt };
}

function validateTime(time: string) {
    if (!HOME_CARE_SLOT_TIME_PATTERN.test(time)) throw new DomainError('وقت التوفر غير صالح', 400, 'HOME_CARE_SLOT_TIME_INVALID');
    return time;
}

function duplicate(error: any) { return error?.code === 11000; }

export class HomeCareAvailabilityService {
    private async requireService(serviceId: string) {
        if (!mongoose.Types.ObjectId.isValid(serviceId)) throw new DomainError('معرف الخدمة غير صالح', 400, 'HOME_CARE_SERVICE_ID_INVALID');
        const service = await HomeCareService.findById(serviceId).exec();
        if (!service) throw new DomainError('الخدمة غير موجودة', 404, 'HOME_CARE_SERVICE_NOT_FOUND');
        return service;
    }

    async listForDashboard(serviceId: string) {
        await this.requireService(serviceId);
        return HomeCareAvailabilitySlot.find({ service_id: serviceId }).sort(HOME_CARE_SLOT_SORT).exec();
    }

    async create(serviceId: string, input: { time: string; display_order?: number; status?: IHomeCareStatus }, actor: HomeCareSlotActor) {
        await this.requireService(serviceId);
        const time = validateTime(input.time);
        const displayOrder = input.display_order ?? 1000;
        if (!Number.isSafeInteger(displayOrder) || displayOrder < 0) throw new DomainError('ترتيب وقت التوفر غير صالح', 400, 'HOME_CARE_SLOT_ORDER_INVALID');
        if (await HomeCareAvailabilitySlot.countDocuments({ service_id: serviceId }) >= HOME_CARE_MAX_AVAILABILITY_SLOTS) throw new DomainError('تم بلوغ الحد الأقصى لأوقات التوفر', 409, 'HOME_CARE_SLOT_LIMIT');
        try {
            const slot = await HomeCareAvailabilitySlot.create({ service_id: serviceId, time, status: input.status ?? IHomeCareStatusEnum.ACTIVE, display_order: displayOrder, created_by: actor.user_id });
            await this.log('POST', IActivityLogActionEnum.CREATE, slot, null, input, actor);
            return slot;
        } catch (error) { if (duplicate(error)) throw new DomainError('وقت التوفر موجود مسبقاً لهذه الخدمة', 409, 'HOME_CARE_SLOT_DUPLICATE'); throw error; }
    }

    async update(serviceId: string, slotId: string, input: { time?: string; display_order?: number }, actor: HomeCareSlotActor) {
        await this.requireService(serviceId);
        if (!mongoose.Types.ObjectId.isValid(slotId)) throw new DomainError('معرف وقت التوفر غير صالح', 400, 'HOME_CARE_SLOT_ID_INVALID');
        const current = await HomeCareAvailabilitySlot.findOne({ _id: slotId, service_id: serviceId }).exec();
        if (!current) throw new DomainError('وقت التوفر غير موجود', 404, 'HOME_CARE_SLOT_NOT_FOUND');
        const update: Record<string, unknown> = {};
        if (input.time !== undefined) update.time = validateTime(input.time);
        if (input.display_order !== undefined) { if (!Number.isSafeInteger(input.display_order) || input.display_order < 0) throw new DomainError('ترتيب وقت التوفر غير صالح', 400, 'HOME_CARE_SLOT_ORDER_INVALID'); update.display_order = input.display_order; }
        try {
            const slot = await HomeCareAvailabilitySlot.findOneAndUpdate({ _id: slotId, service_id: serviceId }, { $set: update }, { new: true, runValidators: true }).exec();
            if (!slot) throw new DomainError('وقت التوفر غير موجود', 404, 'HOME_CARE_SLOT_NOT_FOUND');
            await this.log('PATCH', IActivityLogActionEnum.UPDATE, slot, current, input, actor);
            return slot;
        } catch (error) { if (duplicate(error)) throw new DomainError('وقت التوفر موجود مسبقاً لهذه الخدمة', 409, 'HOME_CARE_SLOT_DUPLICATE'); throw error; }
    }

    async updateStatus(serviceId: string, slotId: string, status: IHomeCareStatus, actor: HomeCareSlotActor) {
        await this.requireService(serviceId);
        if (!mongoose.Types.ObjectId.isValid(slotId)) throw new DomainError('معرف وقت التوفر غير صالح', 400, 'HOME_CARE_SLOT_ID_INVALID');
        const current = await HomeCareAvailabilitySlot.findOne({ _id: slotId, service_id: serviceId }).exec();
        if (!current) throw new DomainError('وقت التوفر غير موجود', 404, 'HOME_CARE_SLOT_NOT_FOUND');
        const slot = await HomeCareAvailabilitySlot.findOneAndUpdate({ _id: slotId, service_id: serviceId }, { $set: { status } }, { new: true, runValidators: true }).exec();
        if (!slot) throw new DomainError('وقت التوفر غير موجود', 404, 'HOME_CARE_SLOT_NOT_FOUND');
        await this.log('PATCH', IActivityLogActionEnum.UPDATE, slot, current, { status }, actor);
        return slot;
    }

    async archive(serviceId: string, slotId: string, actor: HomeCareSlotActor) {
        await this.requireService(serviceId);
        if (!mongoose.Types.ObjectId.isValid(slotId)) throw new DomainError('معرف وقت التوفر غير صالح', 400, 'HOME_CARE_SLOT_ID_INVALID');
        const current = await HomeCareAvailabilitySlot.findOne({ _id: slotId, service_id: serviceId }).exec();
        if (!current) throw new DomainError('وقت التوفر غير موجود', 404, 'HOME_CARE_SLOT_NOT_FOUND');
        const slot = await HomeCareAvailabilitySlot.findOneAndUpdate({ _id: slotId, service_id: serviceId }, { $set: { status: IHomeCareStatusEnum.INACTIVE } }, { new: true, runValidators: true }).exec();
        if (!slot) throw new DomainError('وقت التوفر غير موجود', 404, 'HOME_CARE_SLOT_NOT_FOUND');
        await this.log('DELETE', IActivityLogActionEnum.DELETE, slot, current, { status: IHomeCareStatusEnum.INACTIVE }, actor);
        return slot;
    }

    async replace(serviceId: string, times: string[], actor: HomeCareSlotActor) {
        await this.requireService(serviceId);
        if (!times.length || times.length > HOME_CARE_MAX_AVAILABILITY_SLOTS) throw new DomainError('قائمة أوقات التوفر غير صالحة', 400, 'HOME_CARE_SLOT_LIST_INVALID');
        times.forEach(validateTime);
        if (new Set(times).size !== times.length) throw new DomainError('لا يمكن تكرار وقت التوفر', 400, 'HOME_CARE_SLOT_DUPLICATE');
        const session = await mongoose.startSession();
        let before: any[] = [];
        try {
            await session.withTransaction(async () => {
                before = await HomeCareAvailabilitySlot.find({ service_id: serviceId }).session(session).lean().exec();
                await HomeCareAvailabilitySlot.updateMany({ service_id: serviceId, time: { $nin: times }, status: { $ne: IHomeCareStatusEnum.INACTIVE } }, { $set: { status: IHomeCareStatusEnum.INACTIVE } }, { session });
                await HomeCareAvailabilitySlot.bulkWrite(times.map((time, index) => ({ updateOne: { filter: { service_id: new mongoose.Types.ObjectId(serviceId), time }, update: { $set: { status: IHomeCareStatusEnum.ACTIVE, display_order: (index + 1) * 10 }, $setOnInsert: { created_by: new mongoose.Types.ObjectId(actor.user_id) } }, upsert: true } })), { ordered: true, session });
            });
        } finally { await session.endSession(); }
        const slots = await this.listForDashboard(serviceId);
        await this.log('PUT', IActivityLogActionEnum.BULK_UPDATE, slots, before, { times }, actor);
        return slots;
    }

    async listForMobile(serviceId: string, date: string, now = new Date()) {
        if (!mongoose.Types.ObjectId.isValid(serviceId)) throw new DomainError('معرف الخدمة غير صالح', 400, 'HOME_CARE_SERVICE_ID_INVALID');
        const service = await homeCareServiceService.getActiveById(serviceId);
        if (!service) throw new DomainError('الخدمة غير موجودة أو غير متاحة', 404, 'HOME_CARE_SERVICE_NOT_AVAILABLE');
        validateRequestedDate(date, now);
        const slots = await HomeCareAvailabilitySlot.find({ service_id: serviceId, status: IHomeCareStatusEnum.ACTIVE }).sort(HOME_CARE_SLOT_SORT).exec();
        return slots.filter(slot => homeCareSlotMeetsLeadTime(date, slot.time, now));
    }

    async requireAvailableForRequest(serviceId: string, slotId: string, session?: ClientSession, expectedTime?: string): Promise<HomeCareAvailabilitySlotDocument> {
        if (!mongoose.Types.ObjectId.isValid(slotId)) throw new DomainError('معرف وقت التوفر غير صالح', 400, 'HOME_CARE_SLOT_ID_INVALID');
        const query = HomeCareAvailabilitySlot.findOne({ _id: slotId, service_id: serviceId, status: IHomeCareStatusEnum.ACTIVE, ...(expectedTime ? { time: expectedTime } : {}) });
        if (session) query.session(session);
        const slot = await query.exec();
        if (!slot) throw new DomainError('وقت التوفر غير متاح لهذه الخدمة', 409, 'HOME_CARE_SLOT_NOT_AVAILABLE');
        return slot;
    }

    /** Transactional CAS touch so slot edit/deactivation and request creation serialize. */
    async claimAvailableForRequest(serviceId: string, slotId: string, expectedTime: string, session: ClientSession): Promise<HomeCareAvailabilitySlotDocument> {
        if (!mongoose.Types.ObjectId.isValid(slotId)) throw new DomainError('معرف وقت التوفر غير صالح', 400, 'HOME_CARE_SLOT_ID_INVALID');
        const slot = await HomeCareAvailabilitySlot.findOneAndUpdate(
            { _id: slotId, service_id: serviceId, status: IHomeCareStatusEnum.ACTIVE, time: expectedTime },
            { $inc: { selection_version: 1 } },
            { new: true, session },
        ).exec();
        if (!slot) throw new DomainError('وقت التوفر غير متاح لهذه الخدمة', 409, 'HOME_CARE_SLOT_NOT_AVAILABLE');
        return slot;
    }

    private async log(method: string, action: string, current: any, oldData: any, requestBody: unknown, actor: HomeCareSlotActor) {
        try { await ActivityLogService.logActivity({ user_id: actor.user_id, user_name: actor.user_name ?? `admin_${actor.user_id}`, user_type: actor.user_type ?? 'admin', method, endpoint: actor.endpoint ?? '/dash/admin/home-care/services/availability', action: action as any, collection_name: 'home_care_availability_slots', document_id: Array.isArray(current) ? null : String(current._id), old_data: oldData?.toObject?.() ?? oldData, new_data: Array.isArray(current) ? current.map(formatHomeCareAvailabilitySlot) : current.toObject?.() ?? current, changed_fields: Object.keys((requestBody as object) ?? {}), request_body: requestBody, source: actor.source ?? IActivityLogSourceEnum.DASHBOARD }); } catch {}
    }
}

export default new HomeCareAvailabilityService();
