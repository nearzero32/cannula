import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { openapi } from '@elysia/openapi';
import { rateLimit } from 'elysia-rate-limit';
import { MongoDB } from './databases/database';
import RedisClient from './databases/redis';
import { loadMongoConfigFromEnv } from './databases/config';
import { swaggerConfig } from './constants/swagger.config';
import { dashboardController } from './controller/dash/index';
import { mobileController } from './controller/mobile/index';
import { ActivityLogPlugin } from './middleware/activity-log.middleware';
import { ensureSuperAdminExists } from './migrations/ensure-super-admin.migration';
import { seedChronicConditions } from './migrations/seed-chronic-conditions.migration';
import { seedSuggestions } from './migrations/seed-suggestions.migration';
import { removePasswordShow } from './migrations/remove-password-show.migration';
import { seedHomeCareCategories } from './migrations/seed-home-care-categories.migration';
import { RATE_LIMIT_RESPONSE } from './schemas/api-response.schema';
import { ApiErrorPlugin } from './middleware/api-error.middleware';
import { backfillHealthProfiles } from './migrations/backfill-health-profiles.migration';
import { backfillPharmacyWorkflow } from './migrations/backfill-pharmacy-workflow.migration';
import { assertPharmacyTransactionSupport } from './services/pharmacy-transaction.service';
import { rebuildAppointmentStorage } from './migrations/rebuild-appointments.migration';
import { assertAppointmentTransactionSupport } from './services/appointment-transaction.service';
import { normalizeDoctorBookingSettings } from './migrations/normalize-doctor-booking-settings.migration';
import { registerAppointmentNotificationHandler } from './services/appointment-notification.service';
import { assertProductionConfiguration, assertSwaggerConfiguration, isSwaggerEnabled, parseAllowedOrigins, requestBodyLimitBytes } from './config/production.config';
import { HttpSecurityPlugin } from './middleware/http-security.middleware';

const HEALTH_TIMEOUT_MS = 2_000;

async function withTimeout<T>(operation: Promise<T>, timeoutMs = HEALTH_TIMEOUT_MS): Promise<T> {
    return await Promise.race([
        operation,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error('health check timeout')), timeoutMs)),
    ]);
}

async function bootstrap() {
    assertProductionConfiguration();
    assertSwaggerConfiguration();
    // Connect MongoDB
    const db = MongoDB.getInstance(loadMongoConfigFromEnv());
    await db.connect();
    await assertPharmacyTransactionSupport();
    await assertAppointmentTransactionSupport();
    await removePasswordShow();
    await ensureSuperAdminExists();
    await seedChronicConditions();
    await seedSuggestions();
    await seedHomeCareCategories();
    await backfillHealthProfiles();
    await backfillPharmacyWorkflow();
    await rebuildAppointmentStorage();
    await normalizeDoctorBookingSettings();
    registerAppointmentNotificationHandler();

    // Connect Redis
    await RedisClient.getInstance().connect();

    const origins = parseAllowedOrigins();
    const app = new Elysia({
        prefix: '/api',
        serve: {
            port: Number(process.env.PORT || 3001),
            hostname: process.env.HOST || '0.0.0.0',
            maxRequestBodySize: requestBodyLimitBytes(),
            development: process.env.NODE_ENV !== 'production',
        },
    })
        .use(HttpSecurityPlugin)
        .use(isSwaggerEnabled() ? openapi(swaggerConfig) : new Elysia())
        .use(cors({
            origin: origins.length ? origins : ['http://localhost:3000', 'http://localhost:5173'],
            methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization'],
            credentials: true,
        }))
        .use(rateLimit({
            duration: 60_000,
            max: 100,
            errorResponse: new Response(
                JSON.stringify(RATE_LIMIT_RESPONSE),
                { status: 429, headers: { 'Content-Type': 'application/json' } }
            ),
        }))
        .use(ActivityLogPlugin)
        .use(ApiErrorPlugin)
        .get('/health/live', () => ({ status: 'ok' }))
        .get('/health/ready', async ({ set }) => {
            try {
                const [mongo, redis] = await Promise.all([
                    withTimeout(db.healthCheck()),
                    withTimeout(RedisClient.getInstance().ping()),
                ]);
                if (mongo.status !== 'healthy' || !redis) throw new Error('dependency unavailable');
                return { status: 'ready' };
            } catch {
                set.status = 503;
                return { status: 'not_ready' };
            }
        })
        .use(dashboardController)
        .use(mobileController)
        .listen({ port: Number(process.env.PORT || 3001), hostname: process.env.HOST || '0.0.0.0' });

    console.log(JSON.stringify({ level: 'info', event: 'server_started', port: app.server?.port }));

    let shuttingDown = false;
    const shutdown = async (signal: string) => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(JSON.stringify({ level: 'info', event: 'shutdown_started', signal }));
        const force = setTimeout(() => process.exit(1), 12_000);
        force.unref();
        try {
            await Promise.race([app.stop(), new Promise((_, reject) => setTimeout(() => reject(new Error('drain timeout')), 10_000))]);
            await Promise.allSettled([RedisClient.getInstance().disconnect(), db.disconnect()]);
            clearTimeout(force);
            process.exit(0);
        } catch {
            process.exit(1);
        }
    };
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
    process.once('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((error) => {
    console.error(JSON.stringify({ level: 'fatal', event: 'startup_failed', errorType: error instanceof Error ? error.name : 'unknown' }));
    process.exit(1);
});
