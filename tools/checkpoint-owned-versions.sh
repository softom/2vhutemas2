#!/bin/bash
# Р-78: согласованный checkpoint при краткой остановке единственного API записи.
set -euo pipefail
umask 077
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="/opt/2vhutemas-services/backups/r78-$STAMP"
mkdir "$DEST"
echo "CHECKPOINT $DEST"
trap 'docker start app_api >/dev/null' EXIT
docker stop app_api >/dev/null
docker exec supa_db pg_dump -U postgres -d postgres -Fc > "$DEST/postgres.dump"
docker exec supa_db pg_dumpall -U postgres --globals-only > "$DEST/globals.sql"
# Сохраняются настройки, код, сборка, оригиналы и производные медиа.
# Исключены только воспроизводимые зависимости, копии backup и тестовые окружения.
tar --exclude='opt/2vhutemas-services/backups'  --exclude='opt/2vhutemas-services/r78-check' --exclude='opt/2vhutemas-services/r78-api-test'  --exclude='*/node_modules' -cf "$DEST/server-files.tar" -C /  opt/2vhutemas opt/2vhutemas-services var/www/2vhutemas var/www/gis etc/caddy
docker start app_api >/dev/null
trap - EXIT
(cd "$DEST" && sha256sum postgres.dump globals.sql server-files.tar > SHA256SUMS)
tar -tf "$DEST/server-files.tar" >/dev/null
echo 'ARCHIVE_READABLE true'
echo "CHECKPOINT_COMPLETE $DEST"
