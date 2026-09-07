import crypto from 'node:crypto';
import mongoose, { type ClientSession } from 'mongoose';
import HomeCareRequestIdempotency, { type HomeCareRequestIdempotencyDocument } from '../models/home-care-request-idempotency.model';
import { HomeCareRequestIdempotencyStatusEnum } from '../interfaces/home-care-request-idempotency.interface';
import { DomainError } from './domain-error';
import { normalizeOptionalRequestText, validateHomeCareRequestAddress, type HomeCareRequestAddressInput } from './home-care-request.validation';

export const HOME_CARE_IDEMPOTENCY_RETENTION_HOURS = 24;
export const HOME_CARE_IDEMPOTENCY_RETENTION_MS = HOME_CARE_IDEMPOTENCY_RETENTION_HOURS * 60 * 60 * 1000;
export const HOME_CARE_IDEMPOTENCY_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface HomeCareIdempotencyPayload {
    service_id: string;
    requested_date: string;
    availability_slot_id: string;
    child_id?: string | null;
    address: HomeCareRequestAddressInput;
    notes?: string | null;
}

function canonicalId(value: string): string {
    const trimmed = value.trim();
    return mongoose.Types.ObjectId.isValid(trimmed) ? new mongoose.Types.ObjectId(trimmed).toHexString() : trimmed;
}

export function validateHomeCareIdempotencyKey(value: string | undefined): string {
    const normalized = value?.trim().toLowerCase();
    if (!normalized || normalized.length !== 36 || !HOME_CARE_IDEMPOTENCY_KEY_PATTERN.test(normalized)) {
        throw new DomainError('مفتاح منع التكرار غير صالح', 400, 'HOME_CARE_IDEMPOTENCY_KEY_INVALID');
    }
    return normalized;
}

export function homeCareRequestFingerprint(input: HomeCareIdempotencyPayload): string {
    const address = validateHomeCareRequestAddress(input.address);
    const canonical = {
        service_id: canonicalId(input.service_id),
        requested_date: input.requested_date,
        availability_slot_id: canonicalId(input.availability_slot_id),
        child_id: input.child_id ? canonicalId(input.child_id) : null,
        address: { address_text: address.address_text, lat: address.lat, lng: address.lng },
        notes: normalizeOptionalRequestText(input.notes, 2000, 'الملاحظات طويلة جداً'),
    };
    return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function isHomeCareIdempotencyDuplicate(error: unknown): boolean {
    if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 11000) return false;
    const mongoError = error as { keyPattern?: Record<string, unknown>; message?: string };
    return Boolean(mongoError.keyPattern?.patient_id && mongoError.keyPattern?.idempotency_key) ||
        Boolean(mongoError.message?.includes('home_care_request_idempotency'));
}

export class HomeCareRequestIdempotencyService {
    async find(patientId: mongoose.Types.ObjectId, key: string): Promise<HomeCareRequestIdempotencyDocument | null> {
        return HomeCareRequestIdempotency.findOne({ patient_id: patientId, idempotency_key: key }).select('+request_hash').exec();
    }

    assertCompatible(record: HomeCareRequestIdempotencyDocument, requestHash: string): void {
        if (record.request_hash !== requestHash) {
            throw new DomainError('تم استخدام مفتاح منع التكرار لطلب مختلف', 409, 'HOME_CARE_IDEMPOTENCY_CONFLICT');
        }
        if (record.status !== HomeCareRequestIdempotencyStatusEnum.COMPLETED || !record.request_id) {
            throw new DomainError('طلب سابق بالمفتاح نفسه ما زال قيد المعالجة', 409, 'HOME_CARE_IDEMPOTENCY_PROCESSING');
        }
    }

    async claim(patientId: mongoose.Types.ObjectId, key: string, requestHash: string, now: Date, session: ClientSession): Promise<void> {
        await HomeCareRequestIdempotency.deleteOne({ patient_id: patientId, idempotency_key: key, expires_at: { $lte: now } }, { session });
        await HomeCareRequestIdempotency.create([{
            patient_id: patientId,
            idempotency_key: key,
            request_hash: requestHash,
            status: HomeCareRequestIdempotencyStatusEnum.PROCESSING,
            request_id: null,
            response_status: null,
            expires_at: new Date(now.getTime() + HOME_CARE_IDEMPOTENCY_RETENTION_MS),
        }], { session });
    }

    async complete(patientId: mongoose.Types.ObjectId, key: string, requestId: mongoose.Types.ObjectId, session: ClientSession): Promise<void> {
        const result = await HomeCareRequestIdempotency.updateOne({
            patient_id: patientId,
            idempotency_key: key,
            status: HomeCareRequestIdempotencyStatusEnum.PROCESSING,
        }, { $set: { status: HomeCareRequestIdempotencyStatusEnum.COMPLETED, request_id: requestId, response_status: 201 } }, { session });
        if (result.matchedCount !== 1) throw new DomainError('تعذر إكمال سجل منع التكرار', 409, 'HOME_CARE_IDEMPOTENCY_STATE_CONFLICT');
    }
}

export default new HomeCareRequestIdempotencyService();
