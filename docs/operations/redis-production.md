# Redis production operations

Redis is authoritative for Cannula authentication sessions. Persistent Patient Mobile sessions, current refresh-token mappings, user session indexes, and bounded replay markers are stored in Redis. Losing the Redis dataset intentionally invalidates affected sessions; the application never reconstructs trust from a signed refresh JWT alone.

## Required deployment configuration

- Redis 7.4.x is pinned in `compose.yml`.
- `/data` must be backed by the `redis_data` named volume. Never run production Redis only on the container writable layer.
- AOF is enabled with `appendfsync everysec` and an RDB preamble. An OS or power failure can theoretically lose roughly one second of acknowledged writes; this is not zero-data-loss storage.
- RDB rules are `save 3600 1 300 100 60 10000` and provide backup checkpoints in addition to AOF.
- Redis `maxmemory` is 128 MiB inside the 256 MiB container limit, leaving half the allocation for allocator overhead, client/AOF buffers, and fork copy-on-write. `maxmemory-policy noeviction` is mandatory: at the Redis limit, writes fail rather than silently evict authentication sessions. Reassess both limits from measured production growth; do not raise one without preserving process/fork headroom.
- Redis has no published host port and is attached only to the dedicated `redis_internal` Docker network shared with the API. Production additionally requires a non-empty `REDIS_PASSWORD` (enforced by Cannula's production configuration validation); protect the environment file and never print the credential.
- The container restart policy is `unless-stopped` and its healthcheck authenticates when a password is configured.

Check the effective configuration without printing credentials:

```sh
docker compose config
docker compose ps redis
docker compose exec -T redis sh -c 'if [ -n "${REDIS_PASSWORD:-}" ]; then A="--no-auth-warning -a $REDIS_PASSWORD"; fi; redis-cli $A PING'
docker compose exec -T redis sh -c 'if [ -n "${REDIS_PASSWORD:-}" ]; then A="--no-auth-warning -a $REDIS_PASSWORD"; fi; redis-cli $A INFO persistence | grep -E "^(aof_enabled|aof_rewrite_in_progress|aof_last_bgrewrite_status|rdb_last_bgsave_status):"'
docker compose exec -T redis sh -c 'if [ -n "${REDIS_PASSWORD:-}" ]; then A="--no-auth-warning -a $REDIS_PASSWORD"; fi; redis-cli $A CONFIG GET appendonly appendfsync save maxmemory maxmemory-policy'
docker volume inspect "$(docker compose config --volumes | sed -n '/redis_data/p' | head -1)"
```

Expected values are `appendonly yes`, `appendfsync everysec`, `aof_last_bgrewrite_status:ok`, `rdb_last_bgsave_status:ok`, and `maxmemory-policy noeviction`.

## Backups and scheduling

The backup script requests a non-blocking `BGSAVE`, waits for successful completion, copies the consistent `dump.rdb` outside the live volume, compresses it, writes a SHA-256 checksum, and keeps the newest seven archives. It deliberately does not copy live Redis 7 multipart AOF files.

```sh
sudo install -d -m 0700 /opt/cannula/backups/redis
sudo chmod 0750 /opt/cannula/scripts/backup-redis.sh
sudo /opt/cannula/scripts/backup-redis.sh
sudo install -m 0644 deploy/systemd/cannula-redis-backup.service /etc/systemd/system/
sudo install -m 0644 deploy/systemd/cannula-redis-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cannula-redis-backup.timer
systemctl status cannula-redis-backup.timer
systemctl list-timers cannula-redis-backup.timer
journalctl -u cannula-redis-backup.service --since today
```

The timer runs daily at approximately 03:00 Asia/Baghdad with up to 15 minutes of randomized delay. Set `REDIS_BACKUP_DIR`, `REDIS_BACKUP_RETENTION_COUNT`, `COMPOSE_FILE`, or `REDIS_SERVICE` to override defaults. Monitor the backup filesystem separately and copy encrypted backups off-host; local retention alone does not protect against host or volume loss.

## Isolated restore validation

Never restore over the live volume. First verify the checksum, then load the RDB into an isolated Redis container without publishing it publicly:

```sh
cd /opt/cannula/backups/redis
sha256sum -c redis-YYYY-MM-DDTHHMMSSZ.rdb.gz.sha256
tmpdir="$(mktemp -d)"
gzip -dc redis-YYYY-MM-DDTHHMMSSZ.rdb.gz > "$tmpdir/dump.rdb"
chmod 0600 "$tmpdir/dump.rdb"
docker run --rm -d --name cannula-redis-restore-test -v "$tmpdir:/data:ro" redis:7.4.11-alpine --appendonly no
docker exec cannula-redis-restore-test redis-cli PING
docker exec cannula-redis-restore-test redis-cli INFO keyspace
docker exec cannula-redis-restore-test redis-cli DBSIZE
docker stop cannula-redis-restore-test
rm -rf -- "$tmpdir"
```

Compare aggregate database counts and key types/TTLs using approved diagnostic keys; never print session values, token digests, credentials, or PINs. Persistent Mobile probe keys must report TTL `-1`, Dashboard probes a positive TTL, and replay markers a positive bounded TTL.

## Restart and disaster recovery

Take and verify a backup before changing persistence configuration or recreating the Redis service. A normal restart sequence is:

```sh
sudo /opt/cannula/scripts/backup-redis.sh
docker compose restart redis
docker compose ps redis
docker compose exec -T redis redis-cli PING
```

Use diagnostic probe keys—not user data—to validate graceful restart, stop/start, or crash recovery. With `appendfsync everysec`, abrupt host loss can lose approximately one second of recent writes. If both AOF and RDB are lost, deploy an empty Redis and accept that existing sessions will fail closed and users must authenticate again. Never manufacture Redis session state from JWT claims.

## Monitoring and capacity

Monitor container health/PING, `used_memory`, `used_memory_peak`, `maxmemory`, `evicted_keys`, `rejected_connections`, `connected_clients`, `blocked_clients`, `aof_enabled`, `aof_last_bgrewrite_status`, `aof_rewrite_in_progress`, `rdb_last_bgsave_status`, `latest_fork_usec`, Redis-volume bytes, backup age/size, and filesystem free space.

Critical alerts are: Redis unavailable; `evicted_keys > 0`; failed AOF rewrite or RDB save; backup or restore-validation failure; rejected connections; Redis memory above 80% of 128 MiB; container RSS approaching 80% of 256 MiB; or disk free space below 20% or less than three times the combined live AOF, RDB, and retained-backup footprint.

Do not expose port 6379, use `FLUSHALL`/`FLUSHDB` in production, copy live multipart AOF files as a backup, restore into the live volume, log credentials or token material, or switch away from `noeviction`.
