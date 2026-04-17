import { IMongoDBConfig } from '../interfaces/mongodbConfig.interface';
import { IRedisConfig } from '../interfaces/redisConfig';

/**
 * Load MongoDB configuration from environment variables
 */
export function loadMongoConfigFromEnv(): IMongoDBConfig {
    const uri = process.env.MONGODB_URI;

    if (!uri) {
        throw new Error('MONGODB_URI environment variable is required');
    }

    return {
        uri,
        maxPoolSize: parseInt(process.env.MONGODB_MAX_POOL_SIZE || '10'),
        minPoolSize: parseInt(process.env.MONGODB_MIN_POOL_SIZE || '5'),
        maxIdleTimeMS: parseInt(process.env.MONGODB_MAX_IDLE_TIME_MS || '30000'),
        serverSelectionTimeoutMS: parseInt(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || '5000'),
        socketTimeoutMS: parseInt(process.env.MONGODB_SOCKET_TIMEOUT_MS || '45000'),
        family: 4,
        useNewUrlParser: true,
        useUnifiedTopology: true,
    };
}

/**
 * Validate MongoDB configuration
 */
export function validateMongoConfig(config: IMongoDBConfig): void {
    if (!config.uri) {
        throw new Error('MongoDB URI is required');
    }

    if (config.maxPoolSize && config.maxPoolSize < 1) {
        throw new Error('maxPoolSize must be at least 1');
    }

    if (config.minPoolSize && config.minPoolSize < 0) {
        throw new Error('minPoolSize must be at least 0');
    }

    if (config.maxPoolSize && config.minPoolSize && config.minPoolSize > config.maxPoolSize) {
        throw new Error('minPoolSize cannot be greater than maxPoolSize');
    }
}

/**
 * Load Redis configuration from environment variables
 */
export function loadRedisConfigFromEnv(): IRedisConfig {
    const host = process.env.REDIS_HOST;
    const port = process.env.REDIS_PORT;

    if (!host) {
        throw new Error('REDIS_HOST environment variable is required');
    }

    const redisConfig: IRedisConfig = {
        host,
        port: parseInt(port || '6379', 10),
        password: process.env.REDIS_PASSWORD || null,
        username: process.env.REDIS_USERNAME || null,
        database: process.env.REDIS_DATABASE ? parseInt(process.env.REDIS_DATABASE, 10) : undefined,
        tls: process.env.REDIS_TLS === 'true',
    };

    return redisConfig;
}

/**
 * Validate Redis configuration
 */
export function validateRedisConfig(config: IRedisConfig): void {
    if (!config.host) {
        throw new Error('Redis host is required');
    }

    if (!config.port || Number.isNaN(config.port) || config.port <= 0) {
        throw new Error('Redis port must be a positive number');
    }

    if (config.database !== undefined && (config.database < 0 || Number.isNaN(config.database))) {
        throw new Error('Redis database must be a non-negative number');
    }
}

const mongo = loadMongoConfigFromEnv();
validateMongoConfig(mongo);

const redis = loadRedisConfigFromEnv();
validateRedisConfig(redis);

const config = {
    mongo,
    redis,
};

export default config;
