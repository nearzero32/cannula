import mongoose, { Connection } from 'mongoose';
import { IMongoDBConfig } from '../interfaces/mongodbConfig.interface';

export class MongoDB {
    private static instance: MongoDB;
    private connection: Connection | null = null;
    private isConnecting: boolean = false;
    private config: IMongoDBConfig;

    private constructor(config: IMongoDBConfig) {
        const defaultConfig = {
            maxPoolSize: 10, // Maximum number of connections in the connection pool
            minPoolSize: 5, // Minimum number of connections in the connection pool
            maxIdleTimeMS: 30000, // Close connections after 30 seconds of inactivity
            serverSelectionTimeoutMS: 5000, // How long to try selecting a server
            socketTimeoutMS: 45000, // How long a send or receive on a socket can take before timing out
            family: 4, // Use IPv4, skip trying IPv6
            useNewUrlParser: true,
            useUnifiedTopology: true,
        };

        // Merge config with defaults
        const mergedConfig = { ...defaultConfig, ...config };

        // Construct options object for mongoose.connect
        const options = {
            maxPoolSize: mergedConfig.maxPoolSize,
            minPoolSize: mergedConfig.minPoolSize,
            maxIdleTimeMS: mergedConfig.maxIdleTimeMS,
            serverSelectionTimeoutMS: mergedConfig.serverSelectionTimeoutMS,
            socketTimeoutMS: mergedConfig.socketTimeoutMS,
            family: mergedConfig.family,
            ...(mergedConfig.options || {}),
        };

        this.config = {
            uri: mergedConfig.uri,
            options,
            maxPoolSize: mergedConfig.maxPoolSize,
            minPoolSize: mergedConfig.minPoolSize,
            maxIdleTimeMS: mergedConfig.maxIdleTimeMS,
            serverSelectionTimeoutMS: mergedConfig.serverSelectionTimeoutMS,
            socketTimeoutMS: mergedConfig.socketTimeoutMS,
            family: mergedConfig.family,
            useNewUrlParser: mergedConfig.useNewUrlParser,
            useUnifiedTopology: mergedConfig.useUnifiedTopology,
        };
    }

    /**
     * Get singleton instance of MongoDB connection
     */
    public static getInstance(config?: IMongoDBConfig): MongoDB {
        if (!MongoDB.instance) {
            if (!config) {
                throw new Error('MongoDB configuration is required for first initialization');
            }
            MongoDB.instance = new MongoDB(config);
        }
        return MongoDB.instance;
    }

    /**
     * Connect to MongoDB with connection pooling
     */
    public async connect(): Promise<Connection> {
        if (this.connection && this.connection.readyState === 1) {
            return this.connection;
        }

        if (this.isConnecting) {
            // Wait for the current connection attempt to complete
            return new Promise((resolve, reject) => {
                const checkConnection = () => {
                    if (this.connection && this.connection.readyState === 1) {
                        resolve(this.connection);
                    } else if (!this.isConnecting) {
                        reject(new Error('Connection failed'));
                    } else {
                        setTimeout(checkConnection, 100);
                    }
                };
                checkConnection();
            });
        }

        this.isConnecting = true;

        try {
            console.log('Connecting to MongoDB...');

            // Set up connection event listeners
            this.setupEventListeners();

            // Connect to MongoDB
            await mongoose.connect(this.config.uri, this.config.options);

            this.connection = mongoose.connection;
            this.isConnecting = false;

            console.log('✅ MongoDB connected successfully');
            console.log(`📊 Connection pool size: ${this.config.maxPoolSize}`);

            return this.connection;
        } catch (error) {
            this.isConnecting = false;
            console.error('❌ MongoDB connection error:', error);
            throw error;
        }
    }

    /**
     * Set up connection event listeners
     */
    private setupEventListeners(): void {
        mongoose.connection.on('connected', () => {
            console.log('🔗 Mongoose connected to MongoDB');
        });

        mongoose.connection.on('error', (error) => {
            console.error('❌ Mongoose connection error:', error);
        });

        mongoose.connection.on('disconnected', () => {
            console.log('🔌 Mongoose disconnected from MongoDB');
        });

        mongoose.connection.on('reconnected', () => {
            console.log('🔄 Mongoose reconnected to MongoDB');
        });

        // Handle application termination
        process.on('SIGINT', async () => {
            await this.disconnect();
            process.exit(0);
        });

        process.on('SIGTERM', async () => {
            await this.disconnect();
            process.exit(0);
        });
    }

    /**
     * Get the current connection
     */
    public getConnection(): Connection | null {
        return this.connection;
    }

    /**
     * Check if connected to MongoDB
     */
    public isConnected(): boolean {
        return this.connection !== null && this.connection.readyState === 1;
    }

    /**
     * Get connection status
     */
    public getConnectionState(): string {
        if (!this.connection) return 'not_initialized';

        const states = {
            0: 'disconnected',
            1: 'connected',
            2: 'connecting',
            3: 'disconnecting',
        };

        return states[this.connection.readyState as keyof typeof states] || 'unknown';
    }

    /**
     * Get connection statistics
     */
    public getConnectionStats(): object {
        if (!this.connection) {
            return { status: 'not_connected' };
        }

        return {
            status: this.getConnectionState(),
            host: this.connection.host,
            port: this.connection.port,
            name: this.connection.name,
            readyState: this.connection.readyState,
            config: {
                maxPoolSize: this.config.maxPoolSize,
                minPoolSize: this.config.minPoolSize,
                maxIdleTimeMS: this.config.maxIdleTimeMS,
                serverSelectionTimeoutMS: this.config.serverSelectionTimeoutMS,
            },
        };
    }

    /**
     * Disconnect from MongoDB
     */
    public async disconnect(): Promise<void> {
        if (this.connection) {
            console.log('🔌 Disconnecting from MongoDB...');
            await mongoose.disconnect();
            this.connection = null;
            console.log('✅ Disconnected from MongoDB');
        }
    }

    /**
     * Health check for MongoDB connection
     */
    public async healthCheck(): Promise<{ status: string; latency?: number; error?: string }> {
        try {
            if (!this.isConnected() || !this.connection || !mongoose.connection.db) {
                return { status: 'disconnected' };
            }

            const start = Date.now();
            // Use mongoose connection db property
            await mongoose.connection.db.admin().ping();
            const latency = Date.now() - start;

            return {
                status: 'healthy',
                latency,
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }

    /**
     * Reconnect to MongoDB
     */
    public async reconnect(): Promise<Connection> {
        console.log('🔄 Reconnecting to MongoDB...');
        await this.disconnect();
        return await this.connect();
    }
}

// Export a pre-configured instance factory
export const createMongoDBConnection = (config: IMongoDBConfig): MongoDB => {
    return MongoDB.getInstance(config);
};

// Export default configuration helper
export const getDefaultMongoConfig = (uri: string): IMongoDBConfig => {
    return {
        uri,
        maxPoolSize: 10,
        minPoolSize: 5,
        maxIdleTimeMS: 30000,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        family: 4,
        useNewUrlParser: true,
        useUnifiedTopology: true,
    };
};
