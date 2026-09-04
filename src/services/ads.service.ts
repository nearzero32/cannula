import mongoose, { type PipelineStage } from 'mongoose';
import Ads, { type AdsDocument } from '../models/ads.model';
import type { IAds, IAdsStatus } from '../interfaces/ads.interface';
import { IAdsStatusEnum } from '../interfaces/ads.interface';
import ActivityLogService from './activity-log.service';
import { IActivityLogActionEnum, IActivityLogSourceEnum } from '../interfaces/activity-log.interface';
import uploadPolicyService from './upload-policy.service';
import { UploadPurposeEnum } from '../constants/upload-policy';
import { DomainError } from './domain-error';
import RedisClient from '../databases/redis';

export const MOBILE_ADS_CACHE_TTL_SECONDS = 60;
export const MOBILE_ADS_CACHE_PREFIX = 'cache:mobile:ads:v1';
export const PATIENT_AD_SORT = Object.freeze({ sort_order: 1, _id: 1 } as const);
export const publicAdsMatch = (now: Date): Record<string, unknown> => ({ status: IAdsStatusEnum.ACTIVE, $and: [{ $or: [{ start_date: null }, { start_date: { $lte: now } }] }, { $or: [{ end_date: null }, { end_date: { $gte: now } }] }] });
type Meta = { user_id?: string; user_name?: string; user_type?: string; endpoint?: string; source?: string };

export function assertValidSchedule(start: Date | null | undefined, end: Date | null | undefined) {
    if ((start && Number.isNaN(start.getTime())) || (end && Number.isNaN(end.getTime()))) throw new DomainError('تاريخ الإعلان غير صالح', 422, 'INVALID_AD_SCHEDULE');
    if (start && end && start > end) throw new DomainError('تاريخ البداية يجب أن يسبق أو يساوي تاريخ النهاية', 422, 'INVALID_AD_SCHEDULE');
}

class AdsService {
    private model = Ads; private activityLog = ActivityLogService;
    async getPaginated({ main_match, page = 1, limit = 10, sort = { createdAt: -1 } }: { main_match: Record<string, unknown>; page?: number; limit?: number; sort?: Record<string, 1 | -1> }): Promise<{ data: AdsDocument[]; count: number }> {
        const safePage = Math.max(1, page), safeLimit = Math.min(100, Math.max(1, limit)), skip = (safePage - 1) * safeLimit;
        const [agg] = await this.model.aggregate([{ $match: main_match }, { $facet: { data: [{ $sort: sort }, { $skip: skip }, { $limit: safeLimit }], count: [{ $count: 'count' }] } }] as PipelineStage[]).exec();
        return { data: (agg?.data ?? []) as AdsDocument[], count: agg?.count?.[0]?.count ?? 0 };
    }
    async getById(id: string) { return await this.model.findById(id).exec(); }
    async getPublicById(id: string, now: Date) { return await this.model.findOne({ _id: id, ...publicAdsMatch(now) }).lean().exec(); }
    async invalidateMobileCache() { try { await RedisClient.getInstance().deleteByPattern(`${MOBILE_ADS_CACHE_PREFIX}:*`); } catch { console.warn('Unable to invalidate mobile ads cache'); } }
    async create(payload: Partial<IAds>, meta?: Meta): Promise<AdsDocument> {
        assertValidSchedule(payload.start_date, payload.end_date);
        const media = payload.image ? await uploadPolicyService.requireReadyReference(payload.image, UploadPurposeEnum.AD_IMAGE, 'AD', '000000000000000000000001') : null;
        const doc = await this.model.create(payload); await uploadPolicyService.finalizeReplacement(media, null, String(doc._id), 'image'); await this.invalidateMobileCache();
        try { await this.activityLog.logActivity({ user_id: meta?.user_id, user_name: meta?.user_name, user_type: meta?.user_type, method: 'POST', endpoint: meta?.endpoint || '/ads', action: IActivityLogActionEnum.CREATE, collection_name: 'ads', document_id: String(doc._id), new_data: doc.toObject(), request_body: payload, source: meta?.source || IActivityLogSourceEnum.DASHBOARD }); } catch {}
        return doc;
    }
    async update(id: string, payload: Partial<IAds>, meta?: Meta): Promise<AdsDocument | null> {
        const oldDoc = await this.model.findById(id).exec(); if (!oldDoc) return null;
        assertValidSchedule(payload.start_date === undefined ? oldDoc.start_date : payload.start_date, payload.end_date === undefined ? oldDoc.end_date : payload.end_date);
        const media = payload.image ? await uploadPolicyService.requireReadyReference(payload.image, UploadPurposeEnum.AD_IMAGE, 'AD', id) : null;
        const doc = await this.model.findByIdAndUpdate(id, payload, { returnDocument: 'after', runValidators: true }).exec();
        if (doc && payload.image !== undefined) await uploadPolicyService.finalizeReplacement(media, oldDoc.image, id, 'image');
        if (doc) { await this.invalidateMobileCache(); try { await this.activityLog.logActivity({ user_id: meta?.user_id, user_name: meta?.user_name, user_type: meta?.user_type, method: 'PATCH', endpoint: meta?.endpoint || `/ads/${id}`, action: IActivityLogActionEnum.UPDATE, collection_name: 'ads', document_id: id, old_data: oldDoc.toObject(), new_data: doc.toObject(), changed_fields: Object.keys(payload).filter(k => JSON.stringify((oldDoc as any)[k]) !== JSON.stringify((doc as any)[k])), request_body: payload, source: meta?.source || IActivityLogSourceEnum.DASHBOARD }); } catch {} }
        return doc;
    }
    async updateStatus(id: string, status: IAdsStatus, meta?: Meta) { return await this.update(id, { status }, meta); }
    async reorder(adIds: string[], meta?: Meta) {
        if (!adIds.length || adIds.length > 500) throw new DomainError('قائمة الإعلانات غير صالحة', 400, 'INVALID_AD_ORDER');
        if (adIds.some(id => !mongoose.Types.ObjectId.isValid(id))) throw new DomainError('معرف إعلان غير صالح', 400, 'INVALID_AD_ID');
        if (new Set(adIds).size !== adIds.length) throw new DomainError('لا يمكن تكرار الإعلان في الترتيب', 400, 'DUPLICATE_AD_ID');
        const ids = adIds.map(id => new mongoose.Types.ObjectId(id)), session = await this.model.db.startSession(); let oldOrders: Array<{ _id: mongoose.Types.ObjectId; sort_order?: number }> = [];
        try { await session.withTransaction(async () => { oldOrders = await this.model.find({ _id: { $in: ids } }).select('_id sort_order').session(session).lean().exec(); if (oldOrders.length !== adIds.length) throw new DomainError('يوجد إعلان غير موجود في قائمة الترتيب', 404, 'AD_NOT_FOUND'); const result = await this.model.bulkWrite(adIds.map((id, index) => ({ updateOne: { filter: { _id: new mongoose.Types.ObjectId(id) }, update: { $set: { sort_order: (index + 1) * 10 } } } })), { ordered: true, session }); if (result.matchedCount !== adIds.length) throw new DomainError('تعذر تحديث ترتيب الإعلانات', 409, 'AD_ORDER_CONFLICT'); }); } finally { await session.endSession(); }
        const sortOrders = adIds.map((_, index) => (index + 1) * 10); await this.invalidateMobileCache();
        try { await this.activityLog.logActivity({ user_id: meta?.user_id, user_name: meta?.user_name, user_type: meta?.user_type, method: 'PATCH', endpoint: meta?.endpoint || '/ads/order', action: IActivityLogActionEnum.BULK_UPDATE, collection_name: 'ads', old_data: oldOrders.map(ad => ({ id: String(ad._id), sort_order: ad.sort_order ?? null })), new_data: adIds.map((id, index) => ({ id, sort_order: sortOrders[index] })), changed_fields: ['sort_order'], request_body: { adIds }, source: meta?.source || IActivityLogSourceEnum.DASHBOARD }); } catch {}
        return { adIds, sortOrders };
    }
}
export default new AdsService();
