import { createClient, RedisClientType } from 'redis';
import config from './config';

class RedisClient {
    private static instance: RedisClient;
    private client: RedisClientType;
    private isConnected = false;

    private constructor() {
        if (!config.redis.host) {
            throw new Error('REDIS_HOST environment variable is required');
        }

        const clientOptions: any = {};
        const isProduction = process.env.NODE_ENV === 'production';

        // Build Redis URL with or without password based on environment
        if (isProduction && config.redis.password) {
            clientOptions.url = `redis://:${config.redis.password}@${config.redis.host}:${config.redis.port}`;
        } else {
            clientOptions.url = `redis://${config.redis.host}:${config.redis.port}`;
        }

        this.client = createClient(clientOptions);

        this.client.on('error', (error) => {
            console.error('Redis Client Error:', error);
        });

        this.client.on('connect', () => {
            this.isConnected = true;
        });

        this.client.on('disconnect', () => {
            this.isConnected = false;
        });
    }

    public static getInstance(): RedisClient {
        if (!RedisClient.instance) {
            RedisClient.instance = new RedisClient();
        }
        return RedisClient.instance;
    }

    public async connect(): Promise<void> {
        if (!this.isConnected) {
            await this.client.connect();
        }
    }

    public async disconnect(): Promise<void> {
        if (this.isConnected) {
            await this.client.disconnect();
        }
    }

    public getClient(): RedisClientType {
        return this.client;
    }

    public async get(key: string): Promise<string | null> {
        return await this.client.get(key);
    }

    public async set(key: string, value: string, ttl?: number): Promise<void> {
        if (ttl) {
            await this.client.setEx(key, ttl, value);
        } else {
            await this.client.set(key, value);
        }
    }

    public async del(key: string): Promise<number> {
        return await this.client.del(key);
    }

    public async exists(key: string): Promise<number> {
        return await this.client.exists(key);
    }

    public async flushAll(): Promise<string> {
        return await this.client.flushAll();
    }
}

export default RedisClient;
