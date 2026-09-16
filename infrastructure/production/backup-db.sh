#!/bin/sh
# Nightly pg_dump of both Postgres instances (app + Formance Ledger),
# 14-day local retention. Local-disk only for now — per
# docs/07-SECURITY-AND-AUDIT.md backups must eventually be encrypted and
# off-server before real financial data goes through this system. The
# Ledger dump matters at least as much as the app dump: postings/balances
# live there, not in the app database.
set -e
cd "$(dirname "$0")"
. ../../.env
mkdir -p backups
STAMP=$(date +%Y%m%d-%H%M%S)
docker exec treasury-postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "backups/treasury-$STAMP.sql.gz"
docker exec treasury-formance-postgres pg_dump -U "$FORMANCE_POSTGRES_USER" "$FORMANCE_POSTGRES_DB" | gzip > "backups/treasury-ledger-$STAMP.sql.gz"
find backups -name 'treasury-*.sql.gz' -mtime +14 -delete
echo "backups written: backups/treasury-$STAMP.sql.gz, backups/treasury-ledger-$STAMP.sql.gz"
