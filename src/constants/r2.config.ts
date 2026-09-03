import type { IR2Config } from '../interfaces/r2Config.interface';

export const ALLOWED_IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type AllowedImageContentType = (typeof ALLOWED_IMAGE_CONTENT_TYPES)[number];

const CONTENT_TYPE_EXTENSION: Record<AllowedImageContentType, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
};

export const R2_PRESIGN_MIN_SECONDS = 300;
export const R2_PRESIGN_MAX_SECONDS = 900;
export const R2_UPLOAD_MIN_BYTES = 256 * 1024;
export const R2_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

export class R2ConfigurationError extends Error {
    constructor(public readonly code: 'R2_CONFIG_INCOMPLETE' | 'R2_CONFIG_INVALID', variable: string) {
        super(`${code}:${variable}`);
        this.name = 'R2ConfigurationError';
    }
}

export function extensionForContentType(contentType: AllowedImageContentType): string {
    return CONTENT_TYPE_EXTENSION[contentType];
}

export function isAllowedImageContentType(value: string): value is AllowedImageContentType {
    return (ALLOWED_IMAGE_CONTENT_TYPES as readonly string[]).includes(value);
}

let cachedConfig: IR2Config | null | undefined;

function boundedInteger(raw: string | undefined, fallback: number, minimum: number, maximum: number, variable: string): number {
    const value = raw === undefined || raw.trim() === '' ? fallback : Number(raw);
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new R2ConfigurationError('R2_CONFIG_INVALID', variable);
    return value;
}

function validatedUrl(raw: string, variable: string, production: boolean): string {
    let url: URL;
    try { url = new URL(raw); } catch { throw new R2ConfigurationError('R2_CONFIG_INVALID', variable); }
    if (!['http:', 'https:'].includes(url.protocol) || (production && url.protocol !== 'https:')) throw new R2ConfigurationError('R2_CONFIG_INVALID', variable);
    return raw.replace(/\/$/, '');
}

export function loadR2ConfigFromEnv(environment: NodeJS.ProcessEnv = process.env): IR2Config | null {
    if (environment === process.env && cachedConfig !== undefined) return cachedConfig;
    const accountId = environment.R2_ACCOUNT_ID?.trim();
    const accessKeyId = (environment.R2_ACCESS_KEY_ID ?? environment.AWS_ACCESS_KEY_ID)?.trim();
    const secretAccessKey = (environment.R2_SECRET_ACCESS_KEY ?? environment.AWS_SECRET_ACCESS_KEY)?.trim();
    const bucketName = (environment.R2_BUCKET_NAME ?? environment.AWS_S3_BUCKET_NAME)?.trim();
    const privateBucketName = environment.R2_PRIVATE_BUCKET_NAME?.trim();
    const publicUrl = environment.R2_PUBLIC_URL?.trim();
    const endpoint = environment.R2_ENDPOINT?.trim() ?? environment.AWS_S3_ENDPOINT?.trim() ?? (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined);
    const values = { accessKeyId, secretAccessKey, bucketName, privateBucketName, endpoint, publicUrl };
    if (Object.values(values).every(value => !value)) { if (environment === process.env) cachedConfig = null; return null; }
    for (const [variable, value] of Object.entries(values)) if (!value) throw new R2ConfigurationError('R2_CONFIG_INCOMPLETE', variable);
    const production = environment.NODE_ENV === 'production';
    const config: IR2Config = {
        accountId: accountId ?? '', accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey!, bucketName: bucketName!, privateBucketName: privateBucketName!,
        endpoint: validatedUrl(endpoint!, 'R2_ENDPOINT', production), publicUrl: validatedUrl(publicUrl!, 'R2_PUBLIC_URL', production),
        presignExpiresIn: boundedInteger(environment.R2_PRESIGN_EXPIRES_IN, 600, R2_PRESIGN_MIN_SECONDS, R2_PRESIGN_MAX_SECONDS, 'R2_PRESIGN_EXPIRES_IN'),
        maxUploadBytes: boundedInteger(environment.R2_MAX_UPLOAD_BYTES, 8 * 1024 * 1024, R2_UPLOAD_MIN_BYTES, R2_UPLOAD_MAX_BYTES, 'R2_MAX_UPLOAD_BYTES'),
    };
    if (environment === process.env) cachedConfig = config;
    return config;
}

export function resetR2ConfigCacheForTests(): void { cachedConfig = undefined; }
export function getR2Config(): IR2Config | null { return loadR2ConfigFromEnv(); }
