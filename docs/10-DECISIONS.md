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

## Decision 8 — Kubernetes / Formance production model
Not required for the application MVP.

Decided (2026-09-16): Model B — plain Docker Compose for Formance Ledger in production (`infrastructure/production/docker-compose.yml`), same image as local dev, no Kubernetes. Formance's own docs call the official Kubernetes-operator deployment the only "supported" production topology; this is a deliberate, documented deviation, not an oversight. Reasons: Formance Cloud (the managed alternative) is a paid vendor service, conflicting with this project's no-recurring-fees/self-hosted preference (Decision 4's same reasoning); k3s's control-plane overhead wasn't justified for one service on the current VPS. The VPS was upgraded (1 vCPU/1.9GB → 2 vCPU/3.8GB) specifically to give this model headroom. Revisit once transaction volume, uptime requirements, or compliance needs justify Kubernetes for one service — see `infrastructure/production/README.md`.

## Decision 9 — Supabase
Not an application dependency.

## Decision 10 — TreasuryHub
Reference only.

Repository:
https://github.com/UNLV-CS472-672/2026-S-GROUP9-TreasuryHub

## Decision 11 — Piraeus rAPId Link built against unverified documentation (Phase 9A)

Decided (2026-09-20): `rapidlink.piraeusbank.gr` (including its Swagger
JSON export) returned a TLS certificate this environment's fetch
tooling could not verify — every direct page fetch failed with
"unable to verify the first certificate." The Piraeus adapter
(`lib/providers/piraeus/`) was therefore built on two things instead:
(1) facts confirmed via search-indexed snippets of the same portal
(OAuth param names, base gateway URL, that the AIS product covers
accounts/cards/transactions, the balances/transactions endpoint
existing, `dateFrom`/`dateTo`/`bookingStatus`), and (2) the Berlin
Group NextGenPSD2/XS2A shape, which Piraeus's AIS product is confirmed
(via the same search results) to implement, for everything else
(exact field names/casing, pagination mechanism, token endpoint path).

This is a deliberate, documented risk acceptance, not an oversight —
every assumption is isolated behind the adapter with a `TODO(9A.2)`
comment and listed in `docs/13-PIRAEUS-PROVIDER.md`'s "Assumptions"
table. Phase 9A is explicitly not considered complete until a real
sandbox/production connection (9A.2) confirms or corrects each one.
Revisit this decision if the certificate issue turns out to be
persistent for future provider work too (it would suggest fetching
bank developer-portal docs needs a different tool/approach generally,
not just for Piraeus).
