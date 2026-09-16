#!/bin/sh
# Nightly pg_dump, 14-day local retention. Local-disk only for now — per
# docs/07-SECURITY-AND-AUDIT.md backups must eventually be encrypted and
# off-server before real financial data goes through this system.
set -e
cd "$(dirname "$0")"
. ../../.env
mkdir -p backups
STAMP=$(date +%Y%m%d-%H%M%S)
docker exec treasury-postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "backups/treasury-$STAMP.sql.gz"
find backups -name 'treasury-*.sql.gz' -mtime +14 -delete
echo "backup written: backups/treasury-$STAMP.sql.gz"
