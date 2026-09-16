# Production Deployment

The application is live at **https://wau.digital**,
deployed to the VPS at 38.60.215.236 — the same server that previously ran
the superseded payoutos-mvp Node/Express stack, which was decommissioned to
make room for this one. An unrelated Telegram bot also runs on this host
and was left untouched.

## What's running

`infrastructure/production/docker-compose.yml`, on an internal-only Docker
network:

- `postgres` (17-alpine) — the app database, no published port
- `formance-postgres` (16-alpine) — the Ledger's own database, separate
  from the app database, no published port
- `formance-ledger` (`ghcr.io/formancehq/ledger:v2.4.12`) — Formance
  Ledger itself, no published port, reachable only as
  `http://formance-ledger:3068` from `web`. Runs as plain Docker, **not**
  behind the official Kubernetes operator that Formance's own docs call
  the only "supported" production topology — a deliberate choice for this
  MVP's traffic/budget (see "Formance" below), revisit once volume or
  compliance requirements justify k3s.
- `web` — this app, built from the root `Dockerfile`, no published port
- `caddy` — the only public entry point (`:80`/`:443`), automatic HTTPS via
  Let's Encrypt now that `wau.digital` points at this server (see
  `infrastructure/production/Caddyfile`)
- `migrate` — not started by `up`; a one-off runner (`docker compose run
  --rm migrate`) built from the `builder` stage, which still has the
  Prisma CLI and `tsx` that the slim `web` image drops. `formance-ledger`
  needs no equivalent step — `AUTO_UPGRADE: true` applies its own schema
  migrations on start.

VPS: 2 vCPU / 3.8GB RAM (upgraded 2026-09-16 from 1 vCPU / 1.9GB
specifically to make room for `formance-postgres` + `formance-ledger`
alongside the existing app stack and the unrelated Telegram bot). Current
`mem_limit`s: `postgres` 512m, `web` 512m, `formance-postgres` 384m,
`formance-ledger` 384m, `caddy` 128m — about 1.9GB reserved out of 3.8GB,
leaving headroom for the OS and the Telegram bot.

## Deploying a change

```
scp -r <changed files> myserver:/opt/treasury-platform/...
ssh myserver "cd /opt/treasury-platform/infrastructure/production && \
  docker compose --env-file ../../.env build web && \
  docker compose --env-file ../../.env up -d web"
```

New migration: ship it, then `docker compose --env-file ../../.env run --rm migrate`.

### First deploy of Phase 2 (Formance)

One-time steps on the server before the above applies:

1. Add `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` and
   `FORMANCE_POSTGRES_USER`/`FORMANCE_POSTGRES_PASSWORD`/`FORMANCE_POSTGRES_DB`
   to the real (git-ignored) `/opt/treasury-platform/.env` — see
   `.env.example` for the placeholder shape. Use strong, distinct
   passwords, not the example values.
2. Set `FORMANCE_BASE_URL=http://formance-ledger:3068` and
   `FORMANCE_STACK=treasury-prod` (or similar) in that same `.env` — the
   internal Docker hostname, not `localhost`.
3. Bring up the new services once: `docker compose --env-file ../../.env up -d formance-postgres formance-ledger`, wait for both healthy, then continue with the regular `web` build/up above.

## Backups

`infrastructure/production/backup-db.sh` runs nightly at 03:00 via cron
(`docker exec ... pg_dump | gzip` for **both** `treasury-postgres` and
`treasury-formance-postgres`, 14-day local retention). This is
**local-disk only** — not yet encrypted or off-server, which
docs/07-SECURITY-AND-AUDIT.md requires before real financial data goes
through this system. Open gap, not yet closed. The Ledger dump matters at
least as much as the app dump — postings/balances live there.

## Formance production model — decided

Two models were on the table (`docs/10-DECISIONS.md` Decision 8):

- **Model A** — VPS + k3s/Kubernetes + official Formance operator (the
  only topology Formance's own docs call "supported" in production).
- **Model B** — plain Docker Compose, same image as local dev, no
  Kubernetes.

**Chosen: Model B**, for this MVP stage. Reasoning: Formance Cloud (the
paid managed alternative to self-hosting) conflicts with this project's
stated preference for no recurring vendor fees (the same reasoning
`docs/00-ARCHITECTURE-FREEZE.md` already applied to choosing self-hosted
Better Auth over a hosted auth vendor); k3s's control-plane overhead was
not justified on a VPS this size, and self-hosted Formance Ledger itself
has no license cost either way. This is a conscious deviation from
Formance's documented "supported" production path, not an oversight —
revisit once transaction volume, uptime requirements, or compliance needs
justify the added operational cost of running Kubernetes for one service.

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
