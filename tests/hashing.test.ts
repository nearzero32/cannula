import { describe, expect, test } from 'bun:test';
import { hashPassword, isArgon2Hash, verifyPassword } from '../src/constants/hashing';

describe('password hashing', () => {
    test('creates an Argon2id hash that verifies the same password', async () => {
        const password = 'SamePassword@123';
        const hash = await hashPassword(password);

        expect(hash.startsWith('$argon2id$')).toBe(true);
        expect(await verifyPassword(password, hash)).toBe(true);
    });

    test('rejects a different password', async () => {
        const hash = await hashPassword('correct-password');
        expect(await verifyPassword('wrong-password', hash)).toBe(false);
    });

    test('uses a new salt for each hash while preserving the password value', async () => {
        const password = 'unchanged-value';
        const firstHash = await hashPassword(password);
        const secondHash = await hashPassword(password);

        expect(firstHash).not.toBe(secondHash);
        expect(await verifyPassword(password, firstHash)).toBe(true);
        expect(await verifyPassword(password, secondHash)).toBe(true);
    });

    test('identifies legacy SHA-512 and invalid hashes as non-Argon2', async () => {
        const legacyHash = new Bun.CryptoHasher('sha512').update('password').digest('hex');

        expect(isArgon2Hash(legacyHash)).toBe(false);
        expect(await verifyPassword('password', legacyHash)).toBe(false);
        expect(isArgon2Hash(await hashPassword('password'))).toBe(true);
    });
});
