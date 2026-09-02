import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import mongoose from 'mongoose';
import Admin from '../src/models/admins.model';
import User from '../src/models/users.model';
import { verifyPassword } from '../src/constants/hashing';
import { assertProductionSecurityConfiguration } from '../src/config/security.config';
import { ensureSuperAdminExists } from '../src/migrations/ensure-super-admin.migration';
import BootstrapLock from '../src/models/bootstrap-lock.model';

const ENV_KEYS = ['NODE_ENV', 'SUPER_ADMIN_PHONE', 'SUPER_ADMIN_PASSWORD', 'SUPER_ADMIN_FULL_NAME', 'SUPER_ADMIN_EMAIL'] as const;
const originals = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
const userId = new mongoose.Types.ObjectId();
const query = <T>(value: T) => ({ select() { return this; }, lean() { return this; }, exec: async () => value });

beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.SUPER_ADMIN_PHONE = '07700000000';
    process.env.SUPER_ADMIN_PASSWORD = 'test-bootstrap-password';
    process.env.SUPER_ADMIN_FULL_NAME = 'Initial Admin';
    delete process.env.SUPER_ADMIN_EMAIL;
});

afterEach(() => {
    mock.restore();
    for (const key of ENV_KEYS) {
        const value = originals[key];
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
});

describe('Production security configuration', () => {
    test('requires all token and OTP secrets in production', () => {
        const base = { NODE_ENV: 'production', ACCESS_TOKEN_SECRET: 'access-secure', REFRESH_TOKEN_SECRET: 'refresh-secure', OTP_HASH_SECRET: 'otp-secure' };
        expect(() => assertProductionSecurityConfiguration({ ...base, ACCESS_TOKEN_SECRET: '' })).toThrow('SECURITY_CONFIG_MISSING:ACCESS_TOKEN_SECRET');
        expect(() => assertProductionSecurityConfiguration({ ...base, REFRESH_TOKEN_SECRET: undefined })).toThrow('SECURITY_CONFIG_MISSING:REFRESH_TOKEN_SECRET');
        expect(() => assertProductionSecurityConfiguration({ ...base, OTP_HASH_SECRET: '' })).toThrow('SECURITY_CONFIG_MISSING:OTP_HASH_SECRET');
    });

    test('rejects every documented placeholder secret in production', () => {
        expect(() => assertProductionSecurityConfiguration({ NODE_ENV: 'production', ACCESS_TOKEN_SECRET: 'change-me-use-long-random-string', REFRESH_TOKEN_SECRET: 'safe-refresh', OTP_HASH_SECRET: 'safe-otp' })).toThrow('SECURITY_CONFIG_PLACEHOLDER:ACCESS_TOKEN_SECRET');
        expect(() => assertProductionSecurityConfiguration({ NODE_ENV: 'production', ACCESS_TOKEN_SECRET: 'safe-access', REFRESH_TOKEN_SECRET: 'change-me-use-different-long-random-string', OTP_HASH_SECRET: 'safe-otp' })).toThrow('SECURITY_CONFIG_PLACEHOLDER:REFRESH_TOKEN_SECRET');
        expect(() => assertProductionSecurityConfiguration({ NODE_ENV: 'production', ACCESS_TOKEN_SECRET: 'safe-access', REFRESH_TOKEN_SECRET: 'safe-refresh', OTP_HASH_SECRET: 'change-me-use-a-separate-long-random-string' })).toThrow('SECURITY_CONFIG_PLACEHOLDER:OTP_HASH_SECRET');
    });
});

describe('Initial Super Admin bootstrap', () => {
    test('production fails when initial credentials are missing and never falls back to defaults', async () => {
        process.env.NODE_ENV = 'production';
        delete process.env.SUPER_ADMIN_PHONE;
        delete process.env.SUPER_ADMIN_PASSWORD;
        spyOn(Admin, 'findOne').mockReturnValue(query(null) as never);
        const findUser = spyOn(User, 'findOne');
        const createUser = spyOn(User, 'create');
        await expect(ensureSuperAdminExists()).rejects.toMatchObject({ code: 'SUPER_ADMIN_BOOTSTRAP_REQUIRED' });
        expect(findUser).not.toHaveBeenCalled();
        expect(createUser).not.toHaveBeenCalled();
    });

    test('development without explicit credentials skips bootstrap instead of using defaults', async () => {
        delete process.env.SUPER_ADMIN_PHONE;
        delete process.env.SUPER_ADMIN_PASSWORD;
        spyOn(Admin, 'findOne').mockReturnValue(query(null) as never);
        const createUser = spyOn(User, 'create');
        spyOn(console, 'warn').mockImplementation(() => {});
        await ensureSuperAdminExists();
        expect(createUser).not.toHaveBeenCalled();
    });

    test('enforces a 12-character bootstrap password', async () => {
        process.env.SUPER_ADMIN_PASSWORD = 'short-pass';
        spyOn(Admin, 'findOne').mockReturnValue(query(null) as never);
        await expect(ensureSuperAdminExists()).rejects.toMatchObject({ code: 'SUPER_ADMIN_BOOTSTRAP_PASSWORD_TOO_SHORT' });
    });

    test('initial bootstrap stores only an Argon2id hash and logs no credential', async () => {
        spyOn(Admin, 'findOne').mockReturnValue(query(null) as never);
        spyOn(User, 'findOne').mockReturnValue(query(null) as never);
        spyOn(BootstrapLock, 'create').mockResolvedValue({ _id: 'initial-super-admin' } as never);
        const createUser = spyOn(User, 'create').mockResolvedValue({ _id: userId } as never);
        const createAdmin = spyOn(Admin, 'create').mockResolvedValue({ _id: new mongoose.Types.ObjectId() } as never);
        const log = spyOn(console, 'log').mockImplementation(() => {});

        await ensureSuperAdminExists();
        const payload = (createUser.mock.calls[0] as any)[0];
        expect(payload).not.toHaveProperty('password_show');
        expect(payload.password_hash).toStartWith('$argon2id$');
        expect(await verifyPassword(process.env.SUPER_ADMIN_PASSWORD!, payload.password_hash)).toBe(true);
        expect(createAdmin).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(log.mock.calls)).not.toContain(process.env.SUPER_ADMIN_PASSWORD!);
        expect(JSON.stringify(log.mock.calls)).not.toContain(process.env.SUPER_ADMIN_PHONE!);
    });

    test('a concurrent initial bootstrap lock prevents duplicate creation', async () => {
        spyOn(Admin, 'findOne').mockReturnValue(query(null) as never);
        spyOn(User, 'findOne').mockReturnValue(query(null) as never);
        spyOn(BootstrapLock, 'create').mockRejectedValue({ code: 11000 });
        const createUser = spyOn(User, 'create');
        await expect(ensureSuperAdminExists()).rejects.toMatchObject({ code: 'SUPER_ADMIN_BOOTSTRAP_CONFLICT' });
        expect(createUser).not.toHaveBeenCalled();
    });

    test('restart with a valid Super Admin does not reset or mutate it', async () => {
        const profile = { user_id: userId, super_admin: true, is_active: true, permissions: ['existing'] };
        spyOn(Admin, 'findOne').mockReturnValue(query(profile) as never);
        spyOn(User, 'findOne').mockReturnValue(query({ _id: userId }) as never);
        const createUser = spyOn(User, 'create');
        const createAdmin = spyOn(Admin, 'create');
        const deleteUser = spyOn(User, 'deleteOne');

        await ensureSuperAdminExists();
        expect(createUser).not.toHaveBeenCalled();
        expect(createAdmin).not.toHaveBeenCalled();
        expect(deleteUser).not.toHaveBeenCalled();
        expect(profile.permissions).toEqual(['existing']);
    });

    test('an invalid existing Super Admin identity fails without mutation', async () => {
        spyOn(Admin, 'findOne').mockReturnValue(query({ user_id: userId, super_admin: true, is_active: false }) as never);
        spyOn(User, 'findOne').mockReturnValue(query(null) as never);
        const createUser = spyOn(User, 'create');
        await expect(ensureSuperAdminExists()).rejects.toMatchObject({ code: 'SUPER_ADMIN_BOOTSTRAP_CONFLICT' });
        expect(createUser).not.toHaveBeenCalled();
    });

    test('phone collisions for Patient, Doctor, Nurse, and Pharmacy fail without promotion', async () => {
        spyOn(Admin, 'findOne').mockReturnValue(query(null) as never);
        const collision = { _id: userId, role: 'patient', status: 'active' };
        spyOn(User, 'findOne').mockReturnValue(query(collision) as never);
        const createUser = spyOn(User, 'create');
        const createAdmin = spyOn(Admin, 'create');

        for (const role of ['patient', 'doctor', 'nurse', 'pharmacy']) {
            collision.role = role;
            await expect(ensureSuperAdminExists()).rejects.toMatchObject({ code: 'SUPER_ADMIN_BOOTSTRAP_CONFLICT' });
            expect(collision).toEqual({ _id: userId, role, status: 'active' });
        }
        expect(createUser).not.toHaveBeenCalled();
        expect(createAdmin).not.toHaveBeenCalled();
    });
});
