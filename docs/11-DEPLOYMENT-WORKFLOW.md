# 11 — Phase Deployment Workflow

## Rule

A phase from `docs/05-MVP-ROADMAP.md` is not "done" when its code, tests
and docs are complete locally. It is done when it is live on the
production server (`https://wau.digital`, `38.60.215.236` — see
`infrastructure/production/README.md`) and verified there. Every future
phase follows the steps below before being reported as complete.

This VPS is the only environment (`docs/04-DEPLOYMENT-SPEC.md` — no
separate staging box exists). "Deployed" means deployed there.

## Steps, after a phase's vertical slice is implemented

1. **Local gate.** `pnpm typecheck && pnpm lint && pnpm test` must pass.
   Do not skip this to save time — it's cheaper to fail here than on
   the server.
2. **Commit.** Conventional prefix per `CLAUDE.md` "Git"
   (`feat:`/`fix:`/`test:`/`docs:`/`infra:`).
3. **Push.** `git push origin main`. This also triggers
   `.github/workflows/deploy.yml`, which waits on a manual "production"
   environment approval in GitHub — that pipeline is a secondary,
   audited path, not the one this workflow depends on (see below).
4. **Deploy immediately over SSH** — `ssh myserver` (root@38.60.215.236,
   per `~/.ssh/config`), then, from `/opt/treasury-platform`:
   1. If this phase added a Prisma migration, take a fresh backup first
      (in addition to the nightly cron in
      `infrastructure/production/backup-db.sh`):
      `docker exec treasury-postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" | gzip > /opt/treasury-platform/infrastructure/production/backups/pre-<phase>-$(date +%Y%m%d-%H%M%S).sql.gz`
   2. `git fetch origin main && git reset --hard origin/main`
   3. `cd infrastructure/production`
   4. `docker compose --env-file ../../.env build migrate web`
   5. If this phase added a migration:
      `docker compose --env-file ../../.env run --rm migrate`
   6. `docker compose --env-file ../../.env up -d web`

   Always pass `--env-file ../../.env` — without it, compose warns about
   every variable and can misbehave. `docker compose build` first, every
   time: `up`/`run` alone do not rebuild a changed image
   (`infrastructure/production/README.md`).

   **Run `up -d web` as its own explicit command, and check its own
   output for `Recreate`/`Recreated`/`Started` lines for `web`.**
   Observed during Phase 6: chaining `run --rm migrate` and `up -d web`
   in the same remote script left `web` on the old container (old code,
   new routes 404) even though the image had already been rebuilt and
   the migration succeeded — the `up -d web` step's own effect wasn't
   confirmed from that combined output. Re-running `up -d web` alone
   immediately recreated it correctly. Don't trust a combined script's
   tail output as proof `web` restarted; step 5 below is what actually
   catches this if it happens again.
5. **Verify, on the server or against the public URL:**
   - `curl https://wau.digital/api/health` and `/api/ready` return 200.
   - `docker compose ps` shows the expected services `Up` (no
     `Restarting`/`Exited`).
   - The new migration (if any) appears in `_prisma_migrations`
     (`docker exec treasury-postgres psql -U "$POSTGRES_USER" -d
     "$POSTGRES_DB" -c "select migration_name from _prisma_migrations
     order by finished_at desc limit 5;"`).
   - Smoke-test at least one new route from the phase — an
     unauthenticated call should return 401 (proves the route exists
     and is wired up), not 404 (would mean the deploy didn't actually
     pick up the new code).
6. Only after step 5 passes end-to-end, report the phase as deployed.

## Relationship to the GitHub Actions auto-deploy pipeline

`.github/workflows/deploy.yml` deploys the same way (SSH, build,
migrate, up) automatically whenever `CI` goes green on `main`, but only
after a human clicks approve on the `production` GitHub Environment —
that click is this repo's stand-in for `docs/04-DEPLOYMENT-SPEC.md`'s
"manual production approval" step, since there's no staging environment
to soften it first.

Doing the SSH deploy by hand in step 4 does not skip or replace that
approval gate — the workflow run still sits there waiting for it. The
two mechanisms are redundant, not conflicting: `docker compose up`/`run
--rm migrate` are idempotent, so if a reviewer later approves a pending
run for a commit already deployed by hand, it just redeploys the same
commit safely. Don't rely on the GitHub gate to be the *first* deploy of
a phase — it's an audit trail / fallback, not the fast path this
workflow needs.

## Never on production

- Never run `prisma migrate dev` on the server — only `prisma migrate
  deploy` (the `migrate` compose service already runs this).
- Never hand-edit files on the server outside `.env` — the tree is a
  `git reset --hard` checkout; hand edits are silently discarded on the
  next deploy.
- Never deploy a migration you haven't also written a rollback/recovery
  note for, per `CLAUDE.md` rule 16 — a purely additive migration
  (new tables/columns only, no `DROP`/`ALTER` of existing data) satisfies
  this by construction; anything else needs an explicit note in the
  migration's own commit message.
