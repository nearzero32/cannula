export interface IR2Config {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucketName: string;
    /** Non-public bucket used for pending uploads and sensitive media. */
    privateBucketName: string;
    endpoint: string;
    /** Public base URL (custom domain or r2.dev) used in stored image URLs */
    publicUrl: string;
    presignExpiresIn: number;
    maxUploadBytes: number;
}
