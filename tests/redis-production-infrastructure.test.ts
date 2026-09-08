import { describe, expect, test } from 'bun:test';

const root = new URL('../', import.meta.url);
const read = (path: string) => Bun.file(new URL(path, root)).text();

describe('Redis production infrastructure contract', () => {
    test('Compose pins durable no-eviction Redis without publishing port 6379', async () => {
        const compose = await read('compose.yml');
        expect(compose).toContain('image: redis:7.4.11-alpine');
        expect(compose).toContain('restart: unless-stopped');
        expect(compose).toContain('- redis_data:/data');
        expect(compose).toContain('- --appendonly');
        expect(compose).toContain('- --appendfsync');
        expect(compose).toContain('- everysec');
        expect(compose).toContain('- --aof-use-rdb-preamble');
        expect(compose).toContain('- "3600 1 300 100 60 10000"');
        expect(compose).toContain('- --maxmemory');
        expect(compose).toContain('- 128mb');
        expect(compose).toContain('- noeviction');
        expect(compose).toContain('redis_internal:');
        expect(compose).toContain('internal: true');
        expect(compose).not.toMatch(/\n\s+ports:\s*\n\s+- ["']?(?:0\.0\.0\.0:)?6379:/);
    });

    test('backup script creates checked RDB archives and enforces bounded retention', async () => {
        const script = await read('scripts/backup-redis.sh');
        expect(Bun.file(new URL('scripts/backup-redis.sh', root)).size).toBeGreaterThan(0);
        expect(script).toContain('BGSAVE');
        expect(script).toContain('rdb_last_bgsave_status');
        expect(script).toContain('dump.rdb');
        expect(script).toContain('gzip -c');
        expect(script).toContain('sha256sum');
        expect(script).toContain('REDIS_BACKUP_RETENTION_COUNT:-7');
        expect(script).not.toContain('appendonly.aof');
    });

    test('systemd timer is persistent and explicitly scheduled in Baghdad time', async () => {
        const service = await read('deploy/systemd/cannula-redis-backup.service');
        const timer = await read('deploy/systemd/cannula-redis-backup.timer');
        expect(service).toContain('Type=oneshot');
        expect(service).toContain('ExecStart=/opt/cannula/scripts/backup-redis.sh');
        expect(timer).toContain('OnCalendar=*-*-* 03:00:00 Asia/Baghdad');
        expect(timer).toContain('Persistent=true');
        expect(timer).toContain('RandomizedDelaySec=15m');
    });
});
