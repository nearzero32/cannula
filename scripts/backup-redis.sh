#!/bin/sh
set -eu

umask 077

BACKUP_DIR="${REDIS_BACKUP_DIR:-/opt/cannula/backups/redis}"
RETENTION_COUNT="${REDIS_BACKUP_RETENTION_COUNT:-7}"
COMPOSE_FILE="${COMPOSE_FILE:-/opt/cannula/compose.yml}"
REDIS_SERVICE="${REDIS_SERVICE:-redis}"

case "$RETENTION_COUNT" in
  ''|*[!0-9]*) echo "Redis backup failed: retention must be a positive integer" >&2; exit 2 ;;
  0) echo "Redis backup failed: retention must be greater than zero" >&2; exit 2 ;;
esac

mkdir -p "$BACKUP_DIR"
LOCK_DIR="$BACKUP_DIR/.backup.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "Redis backup failed: another backup is running" >&2
  exit 1
fi

TIMESTAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
TEMP_RDB="$BACKUP_DIR/.redis-$TIMESTAMP.rdb.tmp"
TEMP_ARCHIVE="$BACKUP_DIR/.redis-$TIMESTAMP.rdb.gz.tmp"
FINAL_ARCHIVE="$BACKUP_DIR/redis-$TIMESTAMP.rdb.gz"

cleanup() {
  rm -f -- "$TEMP_RDB" "$TEMP_ARCHIVE"
  rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup EXIT HUP INT TERM

redis_command() {
  docker compose -f "$COMPOSE_FILE" exec -T "$REDIS_SERVICE" sh -c '
    if [ -n "${REDIS_PASSWORD:-}" ]; then
      exec redis-cli --no-auth-warning -a "$REDIS_PASSWORD" "$@"
    fi
    exec redis-cli "$@"
  ' sh "$@"
}

redis_command PING | grep -qx PONG
redis_command BGSAVE >/dev/null

attempt=0
while :; do
  persistence="$(redis_command INFO persistence)"
  in_progress="$(printf '%s\n' "$persistence" | tr -d '\r' | awk -F: '$1 == "rdb_bgsave_in_progress" { print $2 }')"
  status="$(printf '%s\n' "$persistence" | tr -d '\r' | awk -F: '$1 == "rdb_last_bgsave_status" { print $2 }')"
  if [ "$in_progress" = "0" ]; then
    [ "$status" = "ok" ] || { echo "Redis backup failed: BGSAVE status is not ok" >&2; exit 1; }
    break
  fi
  attempt=$((attempt + 1))
  [ "$attempt" -lt 120 ] || { echo "Redis backup failed: BGSAVE timed out" >&2; exit 1; }
  sleep 1
done

docker compose -f "$COMPOSE_FILE" cp "$REDIS_SERVICE:/data/dump.rdb" "$TEMP_RDB" >/dev/null
[ -s "$TEMP_RDB" ] || { echo "Redis backup failed: snapshot is empty" >&2; exit 1; }

gzip -c "$TEMP_RDB" > "$TEMP_ARCHIVE"
[ -s "$TEMP_ARCHIVE" ] || { echo "Redis backup failed: archive is empty" >&2; exit 1; }
mv "$TEMP_ARCHIVE" "$FINAL_ARCHIVE"
archive_name="$(basename "$FINAL_ARCHIVE")"
(cd "$BACKUP_DIR" && sha256sum "$archive_name" > "$archive_name.sha256")

find "$BACKUP_DIR" -maxdepth 1 -type f -name 'redis-*.rdb.gz' -print |
  sort -r | sed -e "1,${RETENTION_COUNT}d" |
  while IFS= read -r old_archive; do
    [ -n "$old_archive" ] || continue
    rm -f -- "$old_archive" "$old_archive.sha256"
  done

archive_size="$(wc -c < "$FINAL_ARCHIVE" | tr -d ' ')"
echo "Redis backup completed: $archive_name ($archive_size bytes)"
