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

Chosen: bank (Piraeus Bank rAPId Link), split into two sub-phases —
see `docs/13-PIRAEUS-PROVIDER.md`.

### Phase 9A — Piraeus Bank Account Information Provider (read-only)

Account discovery, balance observation, transaction synchronization.
No money movement, no payment execution, no change to Phase 6's
`BANK_TRANSFER -> MOCK_BANK` routing. 9A.1 (implementation, this repo)
is not "done" until 9A.2 (real sandbox/production OAuth connection
verified against actual Piraeus credentials) — see
`docs/13-PIRAEUS-PROVIDER.md` "Completion gate".

### Phase 9B — Piraeus payment execution (not started)

create -> execute -> webhook -> ledger -> reconciliation, the full
"first real provider" acceptance criteria above, building on 9A's
account linking/OAuth infrastructure. Requires its own explicit task
(`CLAUDE.md` rule 13) — not implied by 9A.

## Phase 10 — Production hardening

- backup restore
- monitoring
- security review
- dependency scanning
- load tests
- disaster recovery runbook
