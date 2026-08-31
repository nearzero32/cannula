import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import mongoose from 'mongoose';
import HomeCareRequestHistory from '../src/models/home-care-request-history.model';
import { HomeCareRequestHistoryService } from '../src/services/home-care-request-history.service';
import { HomeCareHistoryActorTypeEnum, HomeCareHistoryEventEnum } from '../src/interfaces/home-care-request-history.interface';

afterEach(() => mock.restore());
const requestId = new mongoose.Types.ObjectId('507f191e810c19729de86301');
const payload = {
    request_id: requestId, request_number: 'HC-2026-1', event_type: HomeCareHistoryEventEnum.REQUEST_CREATED,
    actor: { type: HomeCareHistoryActorTypeEnum.PATIENT, user_id: new mongoose.Types.ObjectId(), nurse_id: null },
    from_status: null, to_status: 'pending', from_nurse_id: null, to_nurse_id: null,
    dispatch_mode: 'OPEN_POOL', reason: null, metadata: null,
};

describe('append-only Home Care request history', () => {
    test('retries one transient insertion failure without reverting the source mutation', async () => {
        const service = new HomeCareRequestHistoryService(); let attempts = 0;
        const create = spyOn(HomeCareRequestHistory, 'create').mockImplementation(async () => {
            attempts += 1; if (attempts === 1) throw new Error('transient'); return {} as never;
        });
        await expect(service.append(payload)).resolves.toBeUndefined();
        expect(create).toHaveBeenCalledTimes(2);
    });

    test('history is read chronologically and the service exposes no mutation methods', async () => {
        const service = new HomeCareRequestHistoryService();
        const chain: any = { populate: () => chain, sort: (value: unknown) => { chain.sortValue = value; return chain; }, exec: async () => [] };
        spyOn(HomeCareRequestHistory, 'find').mockReturnValue(chain);
        await service.list(String(requestId));
        expect(chain.sortValue).toEqual({ createdAt: 1, _id: 1 });
        expect('update' in service).toBe(false);
        expect('delete' in service).toBe(false);
    });
});
