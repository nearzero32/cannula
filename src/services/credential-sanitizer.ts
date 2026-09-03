const SECRET_KEYS = new Set([
    'password', 'password_hash', 'password_show', 'pin', 'pinhash', 'pin_hash', 'temporarypin',
    'otp', 'otpcode', 'otp_code', 'debugotp', 'debug_otp', 'otp_hash', 'supportotp', 'support_otp', 'support_otp_hash', 'pin', 'temporarypin', 'temporary_pin', 'accesstoken', 'refreshtoken',
    'access_token', 'refresh_token', 'authorization',
    'uploadurl', 'upload_url', 'presignedurl', 'presigned_url', 'signature', 'x_amz_signature',
    'x_amz_credential', 'x_amz_security_token', 'r2_secret_access_key', 'r2_access_key_id',
]);

export function sanitizeCredentialData(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sanitizeCredentialData);
    if (!value || typeof value !== 'object') return value;
    if (value instanceof Date || typeof (value as { toHexString?: unknown }).toHexString === 'function') return value;
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        const normalized = key.replace(/[-\s]/g, '_').toLowerCase();
        result[key] = SECRET_KEYS.has(normalized) || SECRET_KEYS.has(normalized.replace(/_/g, ''))
            ? '[REDACTED]'
            : sanitizeCredentialData(child);
    }
    return result;
}
