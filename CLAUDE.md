# CLAUDE.md — Treasury Platform

## Mission

Build the Multi-Entity Treasury Platform according to `/docs`.

This is a financial application. Correctness, auditability and idempotency are more important than feature speed.

## Mandatory reading

Before changing code, read:

1. `/docs/00-ARCHITECTURE-FREEZE.md`
2. `/docs/01-DATABASE-SPEC.md`
3. `/docs/02-LEDGER-SPEC.md`
4. `/docs/03-API-SPEC.md`
5. `/docs/04-DEPLOYMENT-SPEC.md`
6. `/docs/05-MVP-ROADMAP.md`
7. `/docs/11-DEPLOYMENT-WORKFLOW.md`

Read the relevant module document before implementing that module.

## Non-negotiable rules

1. Do not introduce microservices.
2. Do not add Supabase as an architectural dependency.
3. Do not use floating point for money.
4. Never store authoritative balances as mutable `company.balance`.
5. Never directly modify a ledger balance.
6. Every money movement must have a traceable Formance transaction ID.
7. Every external money operation must be idempotent.
8. Every webhook must be verified and deduplicated.
9. Provider-specific code must stay behind provider interfaces.
10. Never commit secrets.
11. Never invent production credentials.
12. Never silently change the architecture.
13. Never implement a real provider without an explicit provider-specific task.
14. Financial state transitions require tests.
15. Every important financial mutation requires an audit event.
16. Database migrations must be reversible or have a documented recovery strategy.
17. Do not mix accounting/statutory tax logic into treasury logic without a separate specification.
18. A phase is not complete until it is deployed to the production server and verified there, per `/docs/11-DEPLOYMENT-WORKFLOW.md`. Passing local tests is necessary, not sufficient.

## Development order

Follow `/docs/05-MVP-ROADMAP.md`.

Implement one vertical slice at a time.

Each completed slice must include:
- database migration
- domain/service logic
- API
- validation
- tests
- audit events where applicable
- documentation update
- deployment to production and verification (`/docs/11-DEPLOYMENT-WORKFLOW.md`)

## Agent behavior

Before coding:
- inspect the existing tree
- identify the affected module
- explain the planned files briefly
- implement the smallest coherent change
- run relevant tests/typecheck/lint
- report failures instead of bypassing them

Do not refactor unrelated code.

## Financial invariant

Every completed payment must be traceable:

```text
Business Request
  -> Payment
  -> Provider Operation
  -> Formance Ledger Transaction
  -> Reconciliation
  -> Audit Event
```

No orphan monetary operation is acceptable.

## Git

Use small commits:
- feat:
- fix:
- test:
- refactor:
- docs:
- infra:

Never force-push or rewrite user history unless explicitly instructed.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
