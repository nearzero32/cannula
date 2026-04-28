import { Elysia } from 'elysia';
import { MongoDB } from './databases/database';
import RedisClient from './databases/redis';
import { loadMongoConfigFromEnv } from './databases/config';
import { dashboardController } from './controller/dash/index';
import { mobileController } from './controller/mobile/index';
import { ensureSuperAdminExists } from './migrations/ensure-super-admin.migration';

async function bootstrap() {
    // Connect MongoDB
    const db = MongoDB.getInstance(loadMongoConfigFromEnv());
    await db.connect();
    await ensureSuperAdminExists();

    // Connect Redis
    await RedisClient.getInstance().connect();

    const app = new Elysia()
        .use(dashboardController)
        .use(mobileController)
        .listen(3000);

    console.log(`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`);
}

bootstrap();
