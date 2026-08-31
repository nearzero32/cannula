import mongoose from 'mongoose';
import HomeCareRequestHistory from '../models/home-care-request-history.model';
import type { IHomeCareRequestHistory } from '../interfaces/home-care-request-history.interface';

export class HomeCareRequestHistoryService {
    public async append(payload: Omit<IHomeCareRequestHistory, '_id' | 'createdAt'>): Promise<void> {
        for (let attempt = 0; attempt < 2; attempt += 1) {
            try { await HomeCareRequestHistory.create(payload); return; }
            catch (error) {
                if (attempt === 1 && process.env.NODE_ENV !== 'test') console.error('[CRITICAL] Home Care request history append failed', { request_id: String(payload.request_id), event_type: payload.event_type, error });
            }
        }
    }
    public async list(requestId: string) {
        if (!mongoose.Types.ObjectId.isValid(requestId)) return [];
        return HomeCareRequestHistory.find({ request_id: requestId })
            .populate({ path: 'actor.user_id', select: 'full_name role' })
            .populate({ path: 'actor.nurse_id', select: 'full_name profile_photo' })
            .populate({ path: 'from_nurse_id', select: 'full_name profile_photo' })
            .populate({ path: 'to_nurse_id', select: 'full_name profile_photo' })
            .sort({ createdAt: 1, _id: 1 }).exec();
    }
}
export default new HomeCareRequestHistoryService();
