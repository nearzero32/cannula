import { S3Client } from '@aws-sdk/client-s3';
import { getR2Config } from '../constants/r2.config';

let client: S3Client | null = null;

export function getR2Client(): S3Client | null {
    const config = getR2Config();
    if (!config) {
        return null;
    }

    if (!client) {
        client = new S3Client({
            region: 'auto',
            endpoint: config.endpoint,
            credentials: {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
            },
        });
    }

    return client;
}
