import { ConnectOptions } from 'mongoose';

export interface IMongoDBConfig {
    uri: string;
    options?: ConnectOptions;
    maxPoolSize?: number;
    minPoolSize?: number;
    maxIdleTimeMS?: number;
    serverSelectionTimeoutMS?: number;
    socketTimeoutMS?: number;
    family?: number;
    useNewUrlParser?: boolean;
    useUnifiedTopology?: boolean;
}
