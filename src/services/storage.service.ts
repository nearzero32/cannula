import { randomUUID } from 'crypto';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
    extensionForContentType,
    getR2Config,
    isAllowedImageContentType,
    isUploadFolder,
    type AllowedImageContentType,
    type UploadFolder,
} from '../constants/r2.config';
import { getR2Client } from '../lib/r2.client';

export interface PresignedUploadResult {
    uploadUrl: string;
    publicUrl: string;
    key: string;
    contentType: AllowedImageContentType;
    expiresIn: number;
    maxUploadBytes: number;
}

function sanitizeFileName(fileName?: string): string | null {
    if (!fileName?.trim()) {
        return null;
    }

    const base = fileName.trim().split(/[/\\]/).pop()?.replace(/[^\w.\-()]/g, '') ?? '';
    return base.length > 0 ? base.slice(0, 120) : null;
}

function buildObjectKey(folder: UploadFolder, contentType: AllowedImageContentType, fileName?: string): string {
    const ext = extensionForContentType(contentType);
    const safeName = sanitizeFileName(fileName);

    if (safeName && safeName.includes('.')) {
        return `${folder}/${randomUUID()}-${safeName}`;
    }

    return `${folder}/${randomUUID()}.${ext}`;
}

class StorageService {
    public isConfigured(): boolean {
        return getR2Config() !== null && getR2Client() !== null;
    }

    public async createPresignedUpload({
        folder,
        contentType,
        fileName,
    }: {
        folder: string;
        contentType: string;
        fileName?: string;
    }): Promise<PresignedUploadResult | { error: string }> {
        const config = getR2Config();
        const client = getR2Client();

        if (!config || !client) {
            return { error: 'خدمة التخزين غير مهيأة' };
        }

        if (!isUploadFolder(folder)) {
            return { error: 'مجلد الرفع غير صالح' };
        }

        if (!isAllowedImageContentType(contentType)) {
            return { error: 'نوع الملف غير مدعوم. استخدم JPEG أو PNG أو WebP أو GIF' };
        }

        const key = buildObjectKey(folder, contentType, fileName);

        const command = new PutObjectCommand({
            Bucket: config.bucketName,
            Key: key,
            ContentType: contentType,
        });

        const uploadUrl = await getSignedUrl(client, command, {
            expiresIn: config.presignExpiresIn,
        });

        return {
            uploadUrl,
            publicUrl: `${config.publicUrl}/${key}`,
            key,
            contentType,
            expiresIn: config.presignExpiresIn,
            maxUploadBytes: config.maxUploadBytes,
        };
    }
}

export default new StorageService();
