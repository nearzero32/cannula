export const ARGON2_OPTIONS = {
    algorithm: 'argon2id',
    memoryCost: 65536,
    timeCost: 3,
} as const;

/** Hashes a password with Bun's Argon2id implementation and a random salt. */
export async function hashPassword(input: string): Promise<string> {
    return await Bun.password.hash(input, ARGON2_OPTIONS);
}

/** Verifies a password against an Argon2 hash. Invalid hashes fail closed. */
export async function verifyPassword(input: string, passwordHash: string): Promise<boolean> {
    if (!isArgon2Hash(passwordHash)) return false;

    try {
        return await Bun.password.verify(input, passwordHash);
    } catch {
        return false;
    }
}

export function isArgon2Hash(passwordHash?: string | null): boolean {
    return typeof passwordHash === 'string' && passwordHash.startsWith('$argon2');
}
