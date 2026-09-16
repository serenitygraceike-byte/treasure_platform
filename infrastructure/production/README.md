# Production Deployment

The application (Phase 0/1: no Formance yet) is live at **https://wau.digital**,
deployed to the VPS at 38.60.215.236 — the same server that previously ran
the superseded payoutos-mvp Node/Express stack, which was decommissioned to
make room for this one. An unrelated Telegram bot also runs on this host
and was left untouched.

## What's running

`infrastructure/production/docker-compose.yml`, four services on an
internal-only Docker network:

- `postgres` (17-alpine) — no published port
- `web` — this app, built from the root `Dockerfile`, no published port
- `caddy` — the only public entry point (`:80`/`:443`), automatic HTTPS via
  Let's Encrypt now that `wau.digital` points at this server (see
  `infrastructure/production/Caddyfile`)
- `migrate` — not started by `up`; a one-off runner (`docker compose run
  --rm migrate`) built from the `builder` stage, which still has the
  Prisma CLI and `tsx` that the slim `web` image drops

## Deploying a change

```
scp -r <changed files> myserver:/opt/treasury-platform/...
ssh myserver "cd /opt/treasury-platform/infrastructure/production && \
  docker compose --env-file ../../.env build web && \
  docker compose --env-file ../../.env up -d web"
```

New migration: ship it, then `docker compose --env-file ../../.env run --rm migrate`.

## Backups

`infrastructure/production/backup-db.sh` runs nightly at 03:00 via cron
(`docker exec ... pg_dump | gzip`, 14-day local retention). This is
**local-disk only** — not yet encrypted or off-server, which
docs/07-SECURITY-AND-AUDIT.md requires before real financial data goes
through this system. Open gap, not yet closed.

## Formance (Phase 2, not yet deployed)

Before real financial operations, choose one supported Formance production model:

## Model A
VPS + k3s/Kubernetes + official Formance operator.

## Model B
VPS hosts application/PostgreSQL; Formance Ledger runs in Formance Cloud or another officially supported deployment.

Do not expose PostgreSQL or Formance directly to the Internet.

Public:
- 80
- 443

Private:
- PostgreSQL
- Ledger
- internal application services

Use Caddy:
https://github.com/caddyserver/caddy
