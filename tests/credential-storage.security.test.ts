import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import User from '../src/models/users.model';
import userService from '../src/services/user.service';
import { removePasswordShow } from '../src/migrations/remove-password-show.migration';
import { sanitizeCredentialData } from '../src/services/credential-sanitizer';

afterEach(() => mock.restore());

function aggregateQuery<T>(value: T, capture?: (pipeline: unknown[]) => void) {
    return (pipeline: unknown[]) => {
        capture?.(pipeline);
        return { exec: async () => value };
    };
}

describe('Credential storage and serialization boundaries', () => {
    test('User schema has no recoverable credential and hides the required hash', () => {
        expect(User.schema.path('password_show')).toBeUndefined();
        expect((User.schema.path('password_hash') as any).options).toMatchObject({ required: true, select: false });

        const user = new User({
            full_name: 'Test User', phone: '07700000000', password_hash: '$argon2id$secret',
            password_show: 'must-be-ignored', role: 'patient', status: 'active',
        } as any);
        expect(user.toJSON()).not.toHaveProperty('password_hash');
        expect(user.toJSON()).not.toHaveProperty('password_show');
        expect(user.toObject()).not.toHaveProperty('password_hash');
    });

    test('User aggregation helpers always remove password_hash from API-shaped results', async () => {
        let paginatedPipeline: any[] = [], onePipeline: any[] = [];
        const aggregate = spyOn(User, 'aggregate')
            .mockImplementationOnce(aggregateQuery([{ data: [], count: [] }], pipeline => { paginatedPipeline = pipeline as any[]; }) as never)
            .mockImplementationOnce(aggregateQuery([], pipeline => { onePipeline = pipeline as any[]; }) as never);

        await userService.getPaginated({ main_match: {}, projection: { full_name: 1 } });
        await userService.getOneBy({ projection: { full_name: 1 } });
        expect(paginatedPipeline[1].$facet.data).toContainEqual({ $project: { password_hash: 0 } });
        expect(onePipeline).toContainEqual({ $project: { password_hash: 0 } });
        expect(aggregate).toHaveBeenCalledTimes(2);
    });

    test('cleanup migration removes password_show idempotently without touching password_hash', async () => {
        const update = spyOn(User.collection, 'updateMany')
            .mockResolvedValueOnce({ matchedCount: 2, modifiedCount: 2 } as never)
            .mockResolvedValueOnce({ matchedCount: 0, modifiedCount: 0 } as never);
        const log = spyOn(console, 'log').mockImplementation(() => {});

        expect(await removePasswordShow()).toEqual({ checked: 2, removed: 2 });
        expect(await removePasswordShow()).toEqual({ checked: 0, removed: 0 });
        const [filter, mutation] = update.mock.calls[0] as any;
        expect(filter).toEqual({ password_show: { $exists: true } });
        expect(mutation).toEqual({ $unset: { password_show: '' } });
        expect(JSON.stringify(mutation)).not.toContain('password_hash');
        expect(JSON.stringify(log.mock.calls)).not.toContain('must-be-ignored');
    });

    test('credential sanitizer retains defense-in-depth coverage for old and current names', () => {
        const secrets = {
            password: 'a', password_show: 'b', password_hash: 'c', pin: 'd', temporaryPin: 'e',
            otp: 'f', debugOtp: 'g', supportOtp: 'h', accessToken: 'i', refreshToken: 'j', authorization: 'k',
        };
        const sanitized = sanitizeCredentialData({ nested: secrets, safe: 'visible' }) as any;
        for (const key of Object.keys(secrets)) expect(sanitized.nested[key]).toBe('[REDACTED]');
        expect(sanitized.safe).toBe('visible');
    });
});
