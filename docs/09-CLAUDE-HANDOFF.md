# 09 — Claude Code Handoff

## First prompt

Paste this into Claude Code from the repository root:

> Read `CLAUDE.md` and all documents in `/docs` before making changes.
>
> We are implementing the Multi-Entity Treasury Platform according to the Architecture Freeze.
>
> Do not redesign the architecture.
>
> Do not add microservices.
>
> Do not connect real payment providers.
>
> First inspect the repository and report:
> 1. current files
> 2. current runtime/tool versions
> 3. missing infrastructure
> 4. any conflicts with the architecture documents
>
> Then implement Phase 0 from `/docs/05-MVP-ROADMAP.md`.
>
> Phase 0 must include:
> - Next.js + TypeScript application
> - pnpm
> - PostgreSQL
> - Prisma 7 stable
> - Better Auth
> - Docker development setup
> - environment configuration
> - health/readiness endpoints
> - basic CI
> - tests
>
> Do not implement Phase 1 until Phase 0 tests pass.
>
> After implementation, report:
> - files created/changed
> - commands executed
> - tests
> - known issues
> - exact next step

## Second prompt — database

> Implement Phase 1 database/domain foundation.
>
> Read:
> - `docs/01-DATABASE-SPEC.md`
> - `prisma/schema.prisma.example`
>
> Integrate Better Auth using its current PostgreSQL/Prisma-compatible approach. Do not manually invent Better Auth core tables.
>
> Add application domain models and migrations.
>
> Add seed data for:
> - one organization
> - four example companies
> - sample users/roles
>
> Do not create real bank credentials.
>
> Run migrations, typecheck, lint and tests.

## Third prompt — ledger

> Implement Phase 2.
>
> Read `docs/02-LEDGER-SPEC.md`.
>
> Integrate Formance only through a dedicated LedgerService/LedgerAdapter.
>
> Create deterministic ledger account provisioning.
>
> Implement:
> - account creation
> - posting
> - balance read
> - idempotency
> - correlation IDs
>
> Use a local Formance environment.
>
> Add integration tests for:
> 1. bank -> in_transit
> 2. in_transit -> destination
> 3. reservation/release
>
> Do not implement real bank/crypto/payout providers.

## Important

If a requirement is ambiguous, stop and ask rather than silently inventing a financial rule.
