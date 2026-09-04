import { describe, expect, test } from 'bun:test';
import Ads from '../src/models/ads.model';
import adsService, { assertValidSchedule, PATIENT_AD_SORT, publicAdsMatch } from '../src/services/ads.service';

describe('Ads image banner domain', () => {
    test('requires an image and defaults sort_order to 1000', () => {
        const ad = new Ads();
        expect(ad.sort_order).toBe(1000);
        expect(ad.validateSync()?.errors.image).toBeDefined();
    });

    test('rejects negative and non-integer sort_order values', () => {
        const ad = new Ads({ image: 'https://example.test/banner.png', sort_order: -1.5 });
        expect(ad.validateSync()?.errors.sort_order).toBeDefined();
    });

    test('accepts either schedule boundary alone and validates their final order', () => {
        expect(() => assertValidSchedule(new Date('2026-09-01'), null)).not.toThrow();
        expect(() => assertValidSchedule(null, new Date('2026-09-01'))).not.toThrow();
        expect(() => assertValidSchedule(new Date('2026-09-01'), new Date('2026-09-01'))).not.toThrow();
        expect(() => assertValidSchedule(new Date('2026-09-02'), new Date('2026-09-01'))).toThrow();
        expect(() => assertValidSchedule(new Date('invalid'), null)).toThrow();
    });

    test('uses inclusive scheduling predicates and stable patient ordering before pagination', async () => {
        const now = new Date('2026-09-04T12:00:00.000Z');
        expect(publicAdsMatch(now)).toEqual({ status: 'active', $and: [{ $or: [{ start_date: null }, { start_date: { $lte: now } }] }, { $or: [{ end_date: null }, { end_date: { $gte: now } }] }] });
        expect(PATIENT_AD_SORT).toEqual({ sort_order: 1, _id: 1 });
        const model = (adsService as any).model, original = model.aggregate; let pipeline: any[] = [];
        model.aggregate = (value: any[]) => { pipeline = value; return { exec: async () => [{ data: [], count: [] }] }; };
        try { await adsService.getPaginated({ main_match: publicAdsMatch(now), page: 2, limit: 5, sort: PATIENT_AD_SORT }); } finally { model.aggregate = original; }
        expect(pipeline[1].$facet.data.slice(0, 3)).toEqual([{ $sort: { sort_order: 1, _id: 1 } }, { $skip: 5 }, { $limit: 5 }]);
    });

    test('rejects malformed and duplicate reorder IDs before writes', async () => {
        await expect(adsService.reorder(['not-an-object-id'])).rejects.toMatchObject({ code: 'INVALID_AD_ID' });
        const id = '507f1f77bcf86cd799439011';
        await expect(adsService.reorder([id, id])).rejects.toMatchObject({ code: 'DUPLICATE_AD_ID' });
    });
});
