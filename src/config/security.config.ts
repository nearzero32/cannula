type SecurityEnvironment = Record<string, string | undefined>;

const PRODUCTION_PLACEHOLDERS = new Set([
    'change-me-use-long-random-string',
    'change-me-use-different-long-random-string',
    'change-me-use-a-separate-long-random-string',
]);

export class SecurityConfigurationError extends Error {
    constructor(public readonly code: 'SECURITY_CONFIG_MISSING' | 'SECURITY_CONFIG_PLACEHOLDER', variable: string) {
        super(`${code}:${variable}`);
        this.name = 'SecurityConfigurationError';
    }
}

/** Validates secrets that can be checked before connecting to MongoDB. */
export function assertProductionSecurityConfiguration(environment: SecurityEnvironment = process.env): void {
    if (environment.NODE_ENV !== 'production') return;

    for (const variable of ['ACCESS_TOKEN_SECRET', 'REFRESH_TOKEN_SECRET', 'OTP_HASH_SECRET'] as const) {
        const value = environment[variable]?.trim();
        if (!value) throw new SecurityConfigurationError('SECURITY_CONFIG_MISSING', variable);
        if (PRODUCTION_PLACEHOLDERS.has(value)) {
            throw new SecurityConfigurationError('SECURITY_CONFIG_PLACEHOLDER', variable);
        }
    }
}
