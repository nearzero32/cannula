import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { rateLimit } from 'elysia-rate-limit';
import { MongoDB } from './databases/database';
import RedisClient from './databases/redis';
import { loadMongoConfigFromEnv } from './databases/config';
import { dashboardController } from './controller/dash/index';
import { mobileController } from './controller/mobile/index';
import { ActivityLogPlugin } from './middleware/activity-log.middleware';
import { ensureSuperAdminExists } from './migrations/ensure-super-admin.migration';

async function bootstrap() {
    // Connect MongoDB
    const db = MongoDB.getInstance(loadMongoConfigFromEnv());
    await db.connect();
    await ensureSuperAdminExists();

    // Connect Redis
    await RedisClient.getInstance().connect();

    const app = new Elysia()
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
                JSON.stringify({ error: true, message: 'لقد تجاوزت الحد المسموح به من الطلبات، يرجى المحاولة لاحقاً' }),
                { status: 429, headers: { 'Content-Type': 'application/json' } }
            ),
        }))
        .use(ActivityLogPlugin)
        .use(dashboardController)
        .use(mobileController)
        .onError(({ code, set }) => {
            if (code === 'NOT_FOUND') {
                set.status = 404;
                return {
                    error: true,
                    message: 'المسار غير موجود',
                };
            }
        })
        .listen(3000);

    console.log(`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`);
}

bootstrap();
