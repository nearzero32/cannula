export interface IRedisConfig {
    host: string;
    port: number;
    password?: string | null;
    username?: string | null;
    database?: number;
    tls?: boolean;
}
