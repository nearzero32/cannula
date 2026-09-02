import mongoose from 'mongoose';
import AuthEvent from '../models/auth-event.model';
import type { AuthEventType } from '../interfaces/auth-flow.interface';
import { sanitizeCredentialData } from './credential-sanitizer';

export interface AuthEventInput {
    flow_id?: string | null; phone?: string; user_id?: string | mongoose.Types.ObjectId | null;
    patient_id?: string | mongoose.Types.ObjectId | null; type: AuthEventType; success: boolean;
    reason_code?: string | null; metadata?: unknown; ip_address?: string; device_id?: string;
    device_name?: string; platform?: string; actor_type?: string; actor_user_id?: string | null;
}

class AuthEventService {
    async record(input: AuthEventInput) {
        return await AuthEvent.create({ ...input, metadata: sanitizeCredentialData(input.metadata ?? {}) });
    }
    async list(match: Record<string, unknown>, page = 1, limit = 20) {
        const safePage = Math.max(1, page), safeLimit = Math.min(100, Math.max(1, limit));
        const [result] = await AuthEvent.aggregate([{ $match: match }, { $facet: {
            data: [{ $sort: { createdAt: -1 } }, { $skip: (safePage - 1) * safeLimit }, { $limit: safeLimit }],
            count: [{ $count: 'count' }],
        } }]).exec();
        return { data: result?.data ?? [], count: result?.count?.[0]?.count ?? 0, page: safePage, limit: safeLimit };
    }
    async timeline(flowId: string) { return await AuthEvent.find({ flow_id: flowId }).sort({ createdAt: 1 }).lean().exec(); }
    async patientTimeline(patientId: mongoose.Types.ObjectId) { return await AuthEvent.find({ patient_id: patientId }).sort({ createdAt: 1 }).lean().exec(); }
    async metrics(match: Record<string, unknown>) {
        return await AuthEvent.aggregate([{ $match: match }, { $group: { _id: '$type', count: { $sum: 1 } } }]).exec();
    }
}
export default new AuthEventService();
