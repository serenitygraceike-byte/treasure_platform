# Multi-Entity Treasury Platform — MVP Technical Blueprint

## Status

Architecture Freeze v1 — ready for implementation planning.

## Product

A self-hosted treasury and financial-operations platform for a group of legal entities operating across Greece and Serbia.

The MVP must support:

- multiple companies/legal entities
- multiple bank accounts and currencies
- balances and cash positions
- reserved funds
- money in transit
- intercompany transfers
- operating expenses / OPEX
- freelancers
- contracts
- payment workflows
- provider adapters for bank / crypto / card payout / e-signature
- reconciliation
- 7/30/90-day cash forecasting
- RBAC and audit trail

## Frozen technology decisions

| Layer | Decision |
|---|---|
| Web | Next.js + TypeScript |
| Runtime | Node.js 24 LTS |
| Package manager | pnpm |
| Application DB | PostgreSQL |
| ORM | Prisma ORM 7.x stable line |
| Auth | Better Auth |
| Financial ledger | Formance Ledger |
| Local development | Docker Compose |
| Initial production | Linux VPS + Docker |
| Reverse proxy/TLS | Caddy |
| CI/CD | GitHub Actions |
| Observability | OpenTelemetry-compatible instrumentation |
| Providers | Adapter interfaces only in MVP |
| Microservices | No; modular monolith |
| Supabase | Not used as a platform dependency |

Prisma ORM 8 is currently a release candidate, so the MVP should remain on the stable Prisma 7 line until a deliberate upgrade decision is made. See the upstream release/status information before upgrading.

Better Auth is used instead of Auth.js/NextAuth. The current Auth.js repository explicitly says Auth.js is now part of Better Auth and recommends Better Auth for new projects. Better Auth supports PostgreSQL and Next.js without requiring a hosted auth service.

## Financial architecture

```text
                         WEB / API
                            |
                    MODULAR MONOLITH
                            |
        +-------------------+-------------------+
        |                   |                   |
   Application DB       Domain Services      Providers
    PostgreSQL             |              bank/crypto/payout
        |                  |
        |             Ledger Adapter
        |                  |
        +------------------+
                           |
                    Formance Ledger
                    financial truth
```

The application DB stores business context and workflow state.

Formance Ledger stores authoritative monetary postings and balances.

## Repository references

- Formance Ledger: https://github.com/formancehq/ledger
- Formance Stack: https://github.com/formancehq/stack
- Better Auth: https://github.com/better-auth/better-auth
- Next.js: https://github.com/vercel/next.js
- Prisma ORM: https://github.com/prisma/orm
- PostgreSQL: https://github.com/postgres/postgres
- Caddy: https://github.com/caddyserver/caddy
- OpenTelemetry: https://github.com/open-telemetry/opentelemetry.io
- TreasuryHub reference: https://github.com/UNLV-CS472-672/2026-S-GROUP9-TreasuryHub

## Start here for Claude Code

Read, in order:

1. `CLAUDE.md`
2. `docs/00-ARCHITECTURE-FREEZE.md`
3. `docs/01-DATABASE-SPEC.md`
4. `docs/02-LEDGER-SPEC.md`
5. `docs/03-API-SPEC.md`
6. `docs/04-DEPLOYMENT-SPEC.md`
7. `docs/05-MVP-ROADMAP.md`

Do not start implementing real payment providers until the internal money lifecycle is fully tested.
