# 10 — Architecture Decisions and Current-State Notes

## Decision 1 — Modular monolith
Accepted.

## Decision 2 — PostgreSQL
Accepted.

## Decision 3 — Prisma
Use stable Prisma 7.x for the initial production MVP. Prisma 8 is currently a release candidate and should be evaluated later.

## Decision 4 — Authentication
Use Better Auth, not Auth.js.

Reason:
the current Auth.js repository states that Auth.js has joined Better Auth and recommends Better Auth for new projects.

## Decision 5 — Formance
Use Formance Ledger as the financial posting engine.

Pin a tested release. Do not blindly track `latest`.

## Decision 6 — Providers
Provider adapters first; real integrations later.

Planned families:
- Bank
- Crypto
- Freelancer payout
- E-signature

## Decision 7 — VPS
Initial application infrastructure will be deployed to the already-owned VPS.

## Decision 8 — Kubernetes
Not required for the application MVP, but Formance production deployment requirements must be respected. If self-hosting Formance Ledger in production requires its official Kubernetes operator, use k3s or move Ledger to a supported managed deployment.

## Decision 9 — Supabase
Not an application dependency.

## Decision 10 — TreasuryHub
Reference only.

Repository:
https://github.com/UNLV-CS472-672/2026-S-GROUP9-TreasuryHub
