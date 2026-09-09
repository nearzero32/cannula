import mongoose, { type ClientSession } from 'mongoose';
import HomeCareAvailabilitySlot, { type HomeCareAvailabilitySlotDocument } from '../models/home-care-availability-slot.model';
import HomeCareService from '../models/home-care-service.model';
import homeCareServiceService from './home-care-service.service';
import {
    HOME_CARE_WEEKDAYS,
    HomeCareWeekdayEnum,
    IHomeCareStatusEnum,
    type HomeCareWeekday,
} from '../interfaces/home-care.interface';
import { DomainError } from './domain-error';
import { validateRequestedDate } from './home-care-request.validation';
import { HOME_CARE_TIMEZONE, homeCareSlotMeetsLeadTime, homeCareWeekdayForDate } from './home-care-date.service';
import ActivityLogService from './activity-log.service';
import { IActivityLogActionEnum, IActivityLogSourceEnum } from '../interfaces/activity-log.interface';

export const HOME_CARE_MAX_AVAILABILITY_SLOTS_PER_DAY = 24;
export const HOME_CARE_SLOT_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
export const HOME_CARE_SLOT_SORT = { display_order: 1 as const, time: 1 as const, _id: 1 as const };
export type HomeCareSlotActor = { user_id: string; user_name?: string; user_type?: string; endpoint?: string; source?: string };
export interface HomeCareWeeklyScheduleDay { day_of_week: HomeCareWeekday; times: string[] }
export interface HomeCareWeeklySchedule { service_id: string; timezone: typeof HOME_CARE_TIMEZONE; schedule: HomeCareWeeklyScheduleDay[] }

function validateTime(time: string): string {
    if (!HOME_CARE_SLOT_TIME_PATTERN.test(time)) throw new DomainError('وقت التوفر غير صالح', 400, 'HOME_CARE_SLOT_TIME_INVALID');
    return time;
}

export function validateHomeCareWeeklySchedule(schedule: HomeCareWeeklyScheduleDay[]): HomeCareWeeklyScheduleDay[] {
    if (!Array.isArray(schedule) || schedule.length !== HOME_CARE_WEEKDAYS.length) {
        throw new DomainError('يجب إرسال جدول كامل يتضمن أيام الأسبوع السبعة', 400, 'HOME_CARE_WEEKLY_SCHEDULE_INCOMPLETE');
    }
    const days = new Set<HomeCareWeekday>();
    for (const entry of schedule) {
        if (!Object.values(HomeCareWeekdayEnum).includes(entry.day_of_week)) {
            throw new DomainError('يوم الأسبوع غير صالح', 400, 'HOME_CARE_WEEKDAY_INVALID');
        }
        if (days.has(entry.day_of_week)) throw new DomainError('لا يمكن تكرار يوم الأسبوع', 400, 'HOME_CARE_WEEKDAY_DUPLICATE');
        days.add(entry.day_of_week);
        if (!Array.isArray(entry.times) || entry.times.length > HOME_CARE_MAX_AVAILABILITY_SLOTS_PER_DAY) {
            throw new DomainError('قائمة أوقات التوفر اليومية غير صالحة', 400, 'HOME_CARE_SLOT_LIST_INVALID');
        }
        entry.times.forEach(validateTime);
        if (new Set(entry.times).size !== entry.times.length) {
            throw new DomainError('لا يمكن تكرار وقت التوفر في اليوم نفسه', 400, 'HOME_CARE_SLOT_DUPLICATE');
        }
    }
    if (days.size !== HOME_CARE_WEEKDAYS.length) {
        throw new DomainError('يجب إرسال كل يوم من أيام الأسبوع مرة واحدة', 400, 'HOME_CARE_WEEKLY_SCHEDULE_INCOMPLETE');
    }
    const byDay = new Map(schedule.map(day => [day.day_of_week, day]));
    return HOME_CARE_WEEKDAYS.map(day => ({ day_of_week: day, times: [...byDay.get(day)!.times] }));
}

function duplicate(error: any): boolean { return error?.code === 11000; }

export class HomeCareAvailabilityService {
    private async requireService(serviceId: string) {
        if (!mongoose.Types.ObjectId.isValid(serviceId)) throw new DomainError('معرف الخدمة غير صالح', 400, 'HOME_CARE_SERVICE_ID_INVALID');
        const service = await HomeCareService.findById(serviceId).exec();
        if (!service) throw new DomainError('الخدمة غير موجودة', 404, 'HOME_CARE_SERVICE_NOT_FOUND');
        return service;
    }

    async listForDashboard(serviceId: string): Promise<HomeCareWeeklySchedule> {
        await this.requireService(serviceId);
        const slots = await HomeCareAvailabilitySlot.find({
            service_id: serviceId,
            day_of_week: { $in: HOME_CARE_WEEKDAYS },
            status: IHomeCareStatusEnum.ACTIVE,
        }).sort({ day_of_week: 1, ...HOME_CARE_SLOT_SORT }).exec();
        return {
            service_id: serviceId,
            timezone: HOME_CARE_TIMEZONE,
            schedule: HOME_CARE_WEEKDAYS.map(day => ({
                day_of_week: day,
                times: slots.filter(slot => slot.day_of_week === day).map(slot => slot.time),
            })),
        };
    }

    async replaceWeekly(serviceId: string, input: { schedule: HomeCareWeeklyScheduleDay[] }, actor: HomeCareSlotActor): Promise<HomeCareWeeklySchedule> {
        await this.requireService(serviceId);
        const schedule = validateHomeCareWeeklySchedule(input.schedule);
        const serviceObjectId = new mongoose.Types.ObjectId(serviceId);
        const actorObjectId = new mongoose.Types.ObjectId(actor.user_id);
        const desired = schedule.flatMap(day => day.times.map((time, index) => ({
            day_of_week: day.day_of_week,
            time,
            display_order: (index + 1) * 10,
        })));
        const session = await mongoose.startSession();
        let before: unknown[] = [];
        try {
            await session.withTransaction(async () => {
                before = await HomeCareAvailabilitySlot.find({ service_id: serviceObjectId, day_of_week: { $in: HOME_CARE_WEEKDAYS } })
                    .session(session).lean().exec();
                await HomeCareAvailabilitySlot.updateMany(
                    { service_id: serviceObjectId, day_of_week: { $in: HOME_CARE_WEEKDAYS }, status: IHomeCareStatusEnum.ACTIVE },
                    { $set: { status: IHomeCareStatusEnum.INACTIVE } },
                    { session },
                );
                if (desired.length) {
                    await HomeCareAvailabilitySlot.bulkWrite(desired.map(slot => ({
                        updateOne: {
                            filter: { service_id: serviceObjectId, day_of_week: slot.day_of_week, time: slot.time },
                            update: {
                                $set: { status: IHomeCareStatusEnum.ACTIVE, display_order: slot.display_order },
                                $setOnInsert: { created_by: actorObjectId },
                            },
                            upsert: true,
                        },
                    })), { ordered: true, session });
                }
            }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' });
        } catch (error) {
            if (duplicate(error)) throw new DomainError('وقت التوفر موجود مسبقاً للخدمة واليوم', 409, 'HOME_CARE_SLOT_DUPLICATE');
            throw error;
        } finally { await session.endSession(); }
        const result = await this.listForDashboard(serviceId);
        await this.log(result, before, input, actor);
        return result;
    }

    async listForMobile(serviceId: string, date: string, now = new Date()) {
        if (!mongoose.Types.ObjectId.isValid(serviceId)) throw new DomainError('معرف الخدمة غير صالح', 400, 'HOME_CARE_SERVICE_ID_INVALID');
        const service = await homeCareServiceService.getActiveById(serviceId);
        if (!service) throw new DomainError('الخدمة غير موجودة أو غير متاحة', 404, 'HOME_CARE_SERVICE_NOT_AVAILABLE');
        validateRequestedDate(date, now);
        const slots = await HomeCareAvailabilitySlot.find({
            service_id: serviceId,
            day_of_week: homeCareWeekdayForDate(date),
            status: IHomeCareStatusEnum.ACTIVE,
        }).sort(HOME_CARE_SLOT_SORT).exec();
        return slots.filter(slot => homeCareSlotMeetsLeadTime(date, slot.time, now));
    }

    async requireAvailableForRequest(serviceId: string, slotId: string, requestedDate: string, session?: ClientSession, expectedTime?: string): Promise<HomeCareAvailabilitySlotDocument> {
        if (!mongoose.Types.ObjectId.isValid(slotId)) throw new DomainError('معرف وقت التوفر غير صالح', 400, 'HOME_CARE_SLOT_ID_INVALID');
        const query = HomeCareAvailabilitySlot.findOne({
            _id: slotId,
            service_id: serviceId,
            day_of_week: homeCareWeekdayForDate(requestedDate),
            status: IHomeCareStatusEnum.ACTIVE,
            ...(expectedTime ? { time: expectedTime } : {}),
        });
        if (session) query.session(session);
        const slot = await query.exec();
        if (!slot) throw new DomainError('وقت التوفر غير متاح للتاريخ المحدد', 409, 'HOME_CARE_SLOT_NOT_AVAILABLE_FOR_DATE');
        return slot;
    }

    /** Transactional CAS touch serializes weekly replacement against request creation. */
    async claimAvailableForRequest(serviceId: string, slotId: string, requestedDate: string, expectedTime: string, session: ClientSession): Promise<HomeCareAvailabilitySlotDocument> {
        if (!mongoose.Types.ObjectId.isValid(slotId)) throw new DomainError('معرف وقت التوفر غير صالح', 400, 'HOME_CARE_SLOT_ID_INVALID');
        const slot = await HomeCareAvailabilitySlot.findOneAndUpdate(
            {
                _id: slotId,
                service_id: serviceId,
                day_of_week: homeCareWeekdayForDate(requestedDate),
                status: IHomeCareStatusEnum.ACTIVE,
                time: expectedTime,
            },
            { $inc: { selection_version: 1 } },
            { new: true, session },
        ).exec();
        if (!slot) throw new DomainError('وقت التوفر غير متاح للتاريخ المحدد', 409, 'HOME_CARE_SLOT_NOT_AVAILABLE_FOR_DATE');
        return slot;
    }

    private async log(current: HomeCareWeeklySchedule, oldData: unknown[], requestBody: unknown, actor: HomeCareSlotActor): Promise<void> {
        try {
            await ActivityLogService.logActivity({
                user_id: actor.user_id,
                user_name: actor.user_name ?? `admin_${actor.user_id}`,
                user_type: actor.user_type ?? 'admin',
                method: 'PUT',
                endpoint: actor.endpoint ?? '/dash/admin/home-care/services/availability',
                action: IActivityLogActionEnum.BULK_UPDATE,
                collection_name: 'home_care_availability_slots',
                document_id: null,
                old_data: oldData,
                new_data: current,
                changed_fields: ['schedule'],
                request_body: requestBody,
                response_status: 200,
                source: actor.source ?? IActivityLogSourceEnum.DASHBOARD,
            });
        } catch {}
    }
}

export default new HomeCareAvailabilityService();
