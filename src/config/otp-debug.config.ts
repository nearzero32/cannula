export interface OtpDebugEnvironment {
    NODE_ENV?: string;
    OTP_DEBUG_RETURN_CODE?: string;
}

export function assertOtpDebugConfiguration(env: OtpDebugEnvironment = process.env): void {
    if (env.NODE_ENV === 'production' && env.OTP_DEBUG_RETURN_CODE === 'true') {
        throw new Error('Invalid configuration: OTP_DEBUG_RETURN_CODE=true is forbidden when NODE_ENV=production');
    }
}

export function isOtpDebugReturnEnabled(env: OtpDebugEnvironment = process.env): boolean {
    return env.NODE_ENV !== 'production' && env.OTP_DEBUG_RETURN_CODE === 'true';
}
