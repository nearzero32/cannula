import type { IR2Config } from '../interfaces/r2Config.interface';

export const UploadFolderEnum = {
    ADS: 'ads',
    CLINICS: 'clinics',
    SPECIALTIES: 'specialties',
    DOCTORS: 'doctors',
    PATIENTS: 'patients',
    ABOUT_US: 'about-us',
    UPLOADS: 'uploads',
} as const;

export type UploadFolder = (typeof UploadFolderEnum)[keyof typeof UploadFolderEnum];

export const ALLOWED_IMAGE_CONTENT_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
] as const;

export type AllowedImageContentType = (typeof ALLOWED_IMAGE_CONTENT_TYPES)[number];

const CONTENT_TYPE_EXTENSION: Record<AllowedImageContentType, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
};

export function extensionForContentType(contentType: AllowedImageContentType): string {
    return CONTENT_TYPE_EXTENSION[contentType];
}

export function isAllowedImageContentType(value: string): value is AllowedImageContentType {
    return (ALLOWED_IMAGE_CONTENT_TYPES as readonly string[]).includes(value);
}

export function isUploadFolder(value: string): value is UploadFolder {
    return Object.values(UploadFolderEnum).includes(value as UploadFolder);
}

let cachedConfig: IR2Config | null | undefined;

export function loadR2ConfigFromEnv(): IR2Config | null {
    if (cachedConfig !== undefined) {
        return cachedConfig;
    }

    const accountId = process.env.R2_ACCOUNT_ID?.trim();
    const accessKeyId = (process.env.R2_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID)?.trim();
    const secretAccessKey = (process.env.R2_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY)?.trim();
    const bucketName = (process.env.R2_BUCKET_NAME ?? process.env.AWS_S3_BUCKET_NAME)?.trim();
    const publicUrl = process.env.R2_PUBLIC_URL?.trim();

    const endpoint =
        process.env.R2_ENDPOINT?.trim() ??
        process.env.AWS_S3_ENDPOINT?.trim() ??
        (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined);

    if (!accessKeyId || !secretAccessKey || !bucketName || !endpoint || !publicUrl) {
        cachedConfig = null;
        return null;
    }

    cachedConfig = {
        accountId: accountId ?? '',
        accessKeyId,
        secretAccessKey,
        bucketName,
        endpoint,
        publicUrl: publicUrl.replace(/\/$/, ''),
        presignExpiresIn: Math.max(60, parseInt(process.env.R2_PRESIGN_EXPIRES_IN || '900', 10)),
        maxUploadBytes: Math.max(1, parseInt(process.env.R2_MAX_UPLOAD_BYTES || String(5 * 1024 * 1024), 10)),
    };

    return cachedConfig;
}

export function getR2Config(): IR2Config | null {
    return loadR2ConfigFromEnv();
}
