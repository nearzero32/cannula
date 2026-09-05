import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { localDateTimeToUtc, toBaghdadLocal } from '../../src/services/appointment-time.service';

export const MOBILE_SEED_NAMESPACE = 'cannula-mobile-seed';
export const DEMO_PHONE = '07700000000';
export const DEMO_PIN = '123456';
export const PRODUCTION_CONFIRMATION = 'CANNULA_DEMO_DATA';

export type SeedTarget = 'local' | 'remote';
export type SeedImageMode = 'remote' | 'none';
export interface SeedOptions {
    reset: boolean;
    dryRun: boolean;
    json: boolean;
    target: SeedTarget;
    images: SeedImageMode;
    allowRemote: boolean;
    allowProductionSeed: boolean;
    confirm?: string;
}

export interface SeedConnectionPlan {
    uri: string;
    host: string;
    database: string;
    target: SeedTarget;
    productionLike: boolean;
}

type MongoLikeError = Error & {
    code?: number | string;
    keyPattern?: Record<string, unknown>;
    keyValue?: Record<string, unknown>;
    errors?: Record<string, { message?: string }>;
};

const SECRET_KEY = /password|password_hash|pin|secret|token|uri/i;
function safeRecord(value: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
    if (!value) return undefined;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SECRET_KEY.test(key) ? '[REDACTED]' : item]));
}
function redactMongoCredentials(value: string): string {
    return value.replace(/(mongodb(?:\+srv)?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@');
}

export class SeedEntityError extends Error {
    readonly phase: string;
    readonly seedKey: string;
    readonly entity: string;
    readonly originalName: string;
    readonly mongoCode?: number | string;
    readonly keyPattern?: Record<string, unknown>;
    readonly keyValue?: Record<string, unknown>;
    readonly validationErrors?: Record<string, string>;

    constructor(phase: string, seedKey: string, entity: string, cause: unknown) {
        const original = cause instanceof Error ? cause as MongoLikeError : new Error(String(cause)) as MongoLikeError;
        super(`Seed failed for ${seedKey}: ${original.message}`, { cause: original });
        this.name = 'SeedEntityError';
        this.phase = phase;
        this.seedKey = seedKey;
        this.entity = entity;
        this.originalName = original.name || 'Error';
        this.mongoCode = original.code;
        this.keyPattern = safeRecord(original.keyPattern);
        this.keyValue = safeRecord(original.keyValue);
        if (original.errors) {
            this.validationErrors = Object.fromEntries(Object.entries(original.errors).map(([path, detail]) => [path, detail.message ?? 'Validation failed']));
        }
    }
}

export function formatSeedError(error: unknown, includeStack: boolean): string {
    if (!(error instanceof SeedEntityError)) {
        const message = error instanceof Error ? error.message : String(error);
        const stack = includeStack && error instanceof Error ? `\n${error.stack ?? ''}` : '';
        return redactMongoCredentials(`${message}${stack}`);
    }
    const cause = error.cause as MongoLikeError | undefined;
    const lines = [
        'Seed failed:',
        `  phase: ${error.phase}`,
        `  key: ${error.seedKey}`,
        `  entity: ${error.entity}`,
        `  error: ${error.originalName}`,
        `  details: ${cause?.message ?? error.message}`,
    ];
    if (error.mongoCode !== undefined) lines.push(`  mongoCode: ${error.mongoCode}`);
    if (error.keyPattern) lines.push(`  keyPattern: ${JSON.stringify(error.keyPattern)}`);
    if (error.keyValue) lines.push(`  keyValue: ${JSON.stringify(error.keyValue)}`);
    if (error.validationErrors) {
        for (const [path, message] of Object.entries(error.validationErrors)) lines.push(`  validation.${path}: ${message}`);
    }
    if (includeStack && cause?.stack) lines.push(`  stack:\n${cause.stack}`);
    return redactMongoCredentials(lines.join('\n'));
}

export function deterministicObjectId(entity: string, key: string): mongoose.Types.ObjectId {
    const hex = crypto.createHash('sha256').update(`${MOBILE_SEED_NAMESPACE}:${entity}:${key}`).digest('hex').slice(0, 24);
    return new mongoose.Types.ObjectId(hex);
}

export function credentialDocument(passwordHash: string): { password_hash: string } {
    return { password_hash: passwordHash };
}

export function parseSeedArgs(args: string[]): SeedOptions {
    const options: SeedOptions = {
        reset: false, dryRun: false, json: false, target: 'local', images: 'remote',
        allowRemote: false, allowProductionSeed: false,
    };
    for (const arg of args) {
        if (arg === '--reset') options.reset = true;
        else if (arg === '--dry-run') options.dryRun = true;
        else if (arg === '--json') options.json = true;
        else if (arg === '--allow-remote') options.allowRemote = true;
        else if (arg === '--allow-production-seed') options.allowProductionSeed = true;
        else if (arg === '--profile=full') continue;
        else if (arg.startsWith('--target=')) {
            const value = arg.slice('--target='.length);
            if (value !== 'local' && value !== 'remote') throw new Error(`Unsupported target: ${value}`);
            options.target = value;
        } else if (arg.startsWith('--images=')) {
            const value = arg.slice('--images='.length);
            if (value !== 'remote' && value !== 'none') throw new Error(`Unsupported image mode: ${value}`);
            options.images = value;
        } else if (arg.startsWith('--confirm=')) options.confirm = arg.slice('--confirm='.length);
        else throw new Error(`Unknown option: ${arg}`);
    }
    return options;
}

function databaseFromUri(uri: URL): string {
    const database = decodeURIComponent(uri.pathname.replace(/^\//, '').split('?')[0] ?? '');
    return database || '(default)';
}

export function resolveConnectionPlan(options: SeedOptions, env: Record<string, string | undefined>): SeedConnectionPlan {
    if (options.target === 'remote' && !options.allowRemote) {
        throw new Error('Remote seed refused: pass --allow-remote explicitly.');
    }
    const rawUri = options.target === 'remote'
        ? env.SEED_MONGODB_URI
        : env.SEED_MONGODB_URI ?? env.MONGODB_URI;
    if (!rawUri) throw new Error(options.target === 'remote'
        ? 'SEED_MONGODB_URI is required for --target=remote.'
        : 'SEED_MONGODB_URI or MONGODB_URI is required for local seeding.');
    let parsed: URL;
    try { parsed = new URL(rawUri); } catch { throw new Error('MongoDB URI is invalid.'); }
    if (parsed.protocol !== 'mongodb:' && parsed.protocol !== 'mongodb+srv:') throw new Error('MongoDB URI must use mongodb:// or mongodb+srv://.');
    if (!parsed.username && env.MONGODB_USER && env.MONGODB_PASSWORD) {
        parsed.username = env.MONGODB_USER;
        parsed.password = env.MONGODB_PASSWORD;
    }
    const uri = parsed.toString();
    const host = parsed.host;
    const database = databaseFromUri(parsed);
    const productionLike = env.NODE_ENV === 'production' || /(^|[-_.])(prod|production|live)([-_.]|$)/i.test(`${host} ${database}`);
    if (productionLike && (!options.allowProductionSeed || options.confirm !== PRODUCTION_CONFIRMATION)) {
        throw new Error(`Production-like target refused. Require --allow-production-seed --confirm=${PRODUCTION_CONFIRMATION}.`);
    }
    return { uri, host, database, target: options.target, productionLike };
}

export function mongoConnectionErrorMessage(error: unknown, host: string, runningInDocker: boolean): string {
    const message = error instanceof Error ? error.message : String(error);
    const hostname = host.replace(/^\[/, '').replace(/\](:\d+)?$/, '').split(':')[0]?.toLowerCase();
    if (hostname === 'mongo' && !runningInDocker) {
        return `${message}\nThe hostname "mongo" is available only inside the Docker network. From the Windows host, set SEED_MONGODB_URI to the published MongoDB address (usually 127.0.0.1:27017) and rerun the seed.`;
    }
    return message;
}

export interface RelativeDateFactory {
    localDate(days: number): string;
    at(days: number, time: string): Date;
    days(days: number): Date;
}

export function relativeDates(now: Date): RelativeDateFactory {
    const today = toBaghdadLocal(now).date;
    const shifted = (days: number) => {
        const date = new Date(`${today}T00:00:00.000Z`);
        date.setUTCDate(date.getUTCDate() + days);
        return date.toISOString().slice(0, 10);
    };
    return {
        localDate: shifted,
        at: (days, time) => localDateTimeToUtc(shifted(days), time),
        days: days => localDateTimeToUtc(shifted(days), toBaghdadLocal(now).time),
    };
}

export interface AvailabilityPeriod { start_time: string; end_time: string }
export function validAvailabilityPeriods(periods: readonly AvailabilityPeriod[]): boolean {
    const minutes = (value: string) => {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return Number.NaN;
        const [hour, minute] = value.split(':').map(Number);
        return hour * 60 + minute;
    };
    let previousEnd = -1;
    for (const period of periods) {
        const start = minutes(period.start_time), end = minutes(period.end_time);
        if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || start < previousEnd) return false;
        previousEnd = end;
    }
    return periods.length > 0;
}

export const RESET_ENTITY_KEYS = {
    specialties: Array.from({ length: 12 }, (_, index) => `specialty-${index + 1}`),
    clinics: Array.from({ length: 5 }, (_, index) => `clinic-${index + 1}`),
    doctorUsers: Array.from({ length: 24 }, (_, index) => `doctor-${index + 1}`),
    doctors: Array.from({ length: 24 }, (_, index) => `doctor-${index + 1}`),
    availabilities: Array.from({ length: 24 }, (_, doctor) => Array.from({ length: 7 }, (_, day) => `doctor-${doctor + 1}-day-${day}`)).flat(),
    ads: Array.from({ length: 6 }, (_, index) => `ad-${index + 1}`),
    homeCareCategories: Array.from({ length: 4 }, (_, index) => `category-${index + 1}`),
    homeCareServices: Array.from({ length: 12 }, (_, index) => `service-${index + 1}`),
    nurseUsers: Array.from({ length: 6 }, (_, index) => `nurse-${index + 1}`),
    nurses: Array.from({ length: 6 }, (_, index) => `nurse-${index + 1}`),
    pharmacyUsers: Array.from({ length: 4 }, (_, index) => `pharmacy-${index + 1}`),
    pharmacies: Array.from({ length: 4 }, (_, index) => `pharmacy-${index + 1}`),
    patientUsers: ['mobile-demo'], patients: ['mobile-demo'], healthProfiles: ['mobile-demo'],
    children: ['ali', 'zainab'], childHealthProfiles: ['ali', 'zainab'],
    favorites: Array.from({ length: 5 }, (_, index) => `favorite-${index + 1}`),
    appointments: Array.from({ length: 7 }, (_, index) => `appointment-${index + 1}`),
    homeCareRequests: Array.from({ length: 8 }, (_, index) => `home-care-request-${index + 1}`),
    pharmacyRequests: Array.from({ length: 9 }, (_, index) => `pharmacy-request-${index + 1}`),
    suggestions: Array.from({ length: 6 }, (_, index) => `suggestion-${index + 1}`),
    publicNotifications: Array.from({ length: 10 }, (_, index) => `public-${index + 1}`),
    targetedNotifications: Array.from({ length: 12 }, (_, index) => `targeted-${index + 1}`),
    notificationRecipients: Array.from({ length: 12 }, (_, index) => `targeted-${index + 1}`),
    notificationReads: Array.from({ length: 4 }, (_, index) => `targeted-${index + 1}`),
    aboutUs: ['cannula-demo'],
} as const;

export type ResetEntity = keyof typeof RESET_ENTITY_KEYS;
export function knownSeedIds(entity: ResetEntity, idEntity: string = entity): mongoose.Types.ObjectId[] {
    return [...RESET_ENTITY_KEYS[entity]].map(key => deterministicObjectId(idEntity, key));
}
