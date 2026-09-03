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
        const redisTestUrl = process.env.NODE_ENV === 'test' ? process.env.REDIS_TEST_URL : undefined;

        if (redisTestUrl) {
            const parsed = new URL(redisTestUrl);
            if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname) || !parsed.port || parsed.port === '6379') {
                throw new Error('REDIS_TEST_URL must use loopback and an explicit non-default port');
            }
            clientOptions.url = redisTestUrl;
        }

        if (!redisTestUrl) {
            const protocol = config.redis.tls ? 'rediss:' : 'redis:';
            const url = new URL(`${protocol}//${config.redis.host}:${config.redis.port}`);
            if (config.redis.username) url.username = config.redis.username;
            if (config.redis.password) url.password = config.redis.password;
            clientOptions.url = url.toString();
        }

        this.client = createClient(clientOptions);

        this.client.on('error', () => {
            console.error('Redis client error');
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

    public async ping(): Promise<boolean> {
        if (!this.isConnected) return false;
        return (await this.client.ping()) === 'PONG';
    }

    public async deleteByPattern(pattern: string): Promise<number> {
        let deleted = 0;
        for await (const keys of this.client.scanIterator({ MATCH: pattern, COUNT: 100 })) {
            const batch = Array.isArray(keys) ? keys : [keys];
            if (batch.length) deleted += await this.client.del(batch);
        }
        return deleted;
    }

    public async countByPattern(pattern: string): Promise<number> {
        let count = 0;
        for await (const keys of this.client.scanIterator({ MATCH: pattern, COUNT: 100 })) {
            count += Array.isArray(keys) ? keys.length : 1;
        }
        return count;
    }

    public async exists(key: string): Promise<number> {
        return await this.client.exists(key);
    }

    public async eval(script: string, keys: string[], args: string[]): Promise<unknown> {
        return await this.client.eval(script, { keys, arguments: args });
    }

    public async flushAll(): Promise<string> {
        return await this.client.flushAll();
    }
}

export default RedisClient;
