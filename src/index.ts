import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { swagger } from '@elysiajs/swagger';
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
import { migratePasswordsToArgon2 } from './migrations/migrate-passwords-to-argon2.migration';
import { seedHomeCareCategories } from './migrations/seed-home-care-categories.migration';
import { RATE_LIMIT_RESPONSE } from './schemas/api-response.schema';
import { ApiErrorPlugin } from './middleware/api-error.middleware';
import { backfillHealthProfiles } from './migrations/backfill-health-profiles.migration';
import { repairAppointmentSlotIndex } from './migrations/repair-appointment-slot-index.migration';
import { backfillPharmacyWorkflow } from './migrations/backfill-pharmacy-workflow.migration';
import { assertPharmacyTransactionSupport } from './services/pharmacy-transaction.service';

async function bootstrap() {
    // Connect MongoDB
    const db = MongoDB.getInstance(loadMongoConfigFromEnv());
    await db.connect();
    await assertPharmacyTransactionSupport();
    await ensureSuperAdminExists();
    await migratePasswordsToArgon2();
    await seedChronicConditions();
    await seedSuggestions();
    await seedHomeCareCategories();
    await backfillHealthProfiles();
    await repairAppointmentSlotIndex();
    await backfillPharmacyWorkflow();

    // Connect Redis
    await RedisClient.getInstance().connect();

    const app = new Elysia({
        prefix: '/api',
    })
        .use(swagger(swaggerConfig))
        .use(cors({
            origin: process.env.ALLOWED_ORIGINS
                ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
                : true,
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
        .use(dashboardController)
        .use(mobileController)
        .listen(3001);

    console.log(`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`);
}

bootstrap();
