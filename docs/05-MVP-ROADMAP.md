# 05 — MVP Roadmap

## Phase 0 — Repository and infrastructure skeleton

Deliver:
- Next.js app
- TypeScript
- pnpm
- Prisma 7
- PostgreSQL
- Better Auth
- Docker Compose
- CI
- `.env.example`
- health endpoints

Acceptance:
- developer can clone and run one command
- login works
- DB migration works
- tests run

## Phase 1 — Organization

- organization
- companies
- users
- memberships
- RBAC
- company access

## Phase 2 — Ledger

- Formance integration
- account provisioning
- ledger adapter
- posting service
- balance queries
- idempotency

Acceptance:
- create a company
- create its ledger accounts
- post a test transaction
- read resulting balance
- repeat same idempotency key safely

## Phase 3 — Treasury

- bank accounts
- manual transactions
- reservations
- in-transit
- dashboard

Acceptance:
- transfer moves from available -> in transit -> settled

## Phase 4 — Intercompany

- A -> B transfer
- obligations
- settlement
- reconciliation

## Phase 5 — OPEX

- categories
- expenses
- recurring expenses
- budgets
- actual vs budget

## Phase 6 — Payment orchestration

- approval workflow
- provider interface
- mock provider
- webhook framework
- failure/retry model

## Phase 7 — Freelancers and contracts

- freelancer records
- contract
- document storage
- signature status
- invoice/work record
- payout request

## Phase 8 — Forecast

- 7/30/90 day
- recurring expenses
- expected inflows
- expected outflows
- runway

## Phase 9 — First real provider

Choose ONE:
- bank
- crypto
- payout

Implement end-to-end:
create -> execute -> webhook -> ledger -> reconciliation.

## Phase 10 — Production hardening

- backup restore
- monitoring
- security review
- dependency scanning
- load tests
- disaster recovery runbook
