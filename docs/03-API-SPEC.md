# 03 — API Specification

Base path:

`/api/v1`

## Organizations

- GET `/organizations`
- GET `/organizations/:id`

## Companies

- GET `/companies`
- POST `/companies`
- GET `/companies/:id`
- PATCH `/companies/:id`

## Bank accounts

- GET `/companies/:id/bank-accounts`
- POST `/companies/:id/bank-accounts`
- PATCH `/bank-accounts/:id`

## Reservations (Phase 3 — not in the original spec)

- POST `/bank-accounts/:id/reservations`
- POST `/reservations/:id/release`
- GET `/companies/:id/reservations`

Reserve/release move funds within one bank account's own ledger accounts
(`docs/02-LEDGER-SPEC.md` posting patterns A/B). `POST .../reservations`
requires an `Idempotency-Key` header. `POST .../release` needs none — a
reservation can only leave `ACTIVE` once, so repeating the call is
already safe by status, not by a client-supplied key.

## Transfers (Phase 3 — not in the original spec)

- POST `/bank-accounts/:id/transfers`
- POST `/transfers/:id/settle`
- GET `/companies/:id/transfers`

Start/settle move funds `bank -> in_transit -> destination` (posting
patterns C/D). Scope: `destinationAccountId` must be another bank
account of the *same* company — cross-company movement is Phase 4
"Intercompany", not this. `POST .../transfers` requires an
`Idempotency-Key` header; `POST .../settle` needs none, same reasoning
as reservation release.

## Transactions

- GET `/transactions`
- GET `/transactions/:id`

## Payments

- POST `/payments`
- GET `/payments`
- GET `/payments/:id`
- POST `/payments/:id/approve`
- POST `/payments/:id/reject`
- POST `/payments/:id/execute`
- POST `/payments/:id/cancel`

Headers:
- `Authorization`
- `Idempotency-Key`
- `X-Correlation-ID`

## Intercompany

- POST `/intercompany-transfers`
- GET `/intercompany-transfers`
- GET `/intercompany-transfers/:id`
- POST `/intercompany-transfers/:id/approve`
- POST `/intercompany-transfers/:id/reject` (Phase 4 — not in the original spec; approve-only left no way to decline a request, mirrors the `reject` verb already used for Payments above)
- POST `/intercompany-transfers/:id/reconcile`

`approve`/`reject` require an org-level `APPROVER`, `ADMIN` or `OWNER` — not scoped to either company in the transfer, since approval spans both. `reconcile` requires a `TREASURY_MANAGER`+ of the *receiving* company. `POST /intercompany-transfers` requires `Idempotency-Key`; the other three don't (guarded by status transition instead — a transfer can only leave `PENDING_APPROVAL`/reach reconciled once).

## Expense categories (Phase 5 — not in the original spec)

- POST `/expense-categories`
- GET `/expense-categories`

Org-scoped (`organizationId` body/query param), shared by every company
in the organization (`docs/01-DATABASE-SPEC.md` `expense_categories`).
Managing the category tree requires an org-level `ADMIN`/`OWNER` —
narrower than `canManageExpenses` below, since categories are shared
taxonomy, not a per-company record.

## Expenses

- POST `/expenses`
- GET `/expenses`
- GET `/expenses/:id`
- PATCH `/expenses/:id`
- POST `/expenses/:id/approve`

`GET /expenses` takes a `companyId` query parameter, same pattern as
`GET /intercompany-transfers`. Creating/editing an expense requires
`ACCOUNTANT`, `ADMIN` or `OWNER` on that company (`canManageExpenses`);
`PATCH` only succeeds while the expense is `PENDING_APPROVAL` — an
`APPROVED` expense is immutable. `POST .../approve` requires an
`APPROVER`, `ADMIN` or `OWNER` of that company (`canApproveExpense`,
company-scoped — unlike intercompany approval, an expense never spans
two companies). No `Idempotency-Key` header: unlike a payment or
transfer, recording an expense doesn't move money — `docs/01-DATABASE-
SPEC.md`'s `expenses` table has no `idempotency_key` column.

## Budgets (Phase 5 — not in the original spec)

- POST `/companies/:id/budgets`
- GET `/companies/:id/budgets?periodYear=&periodMonth=`
- GET `/companies/:id/budgets/actual-vs-budget?periodYear=&periodMonth=`

One monthly budget per `(company, category)`. `POST` is an upsert keyed
by `(companyId, categoryId, periodYear, periodMonth)` — repeating the
call updates the amount, no `Idempotency-Key` needed. `actual-vs-budget`
sums that period's `APPROVED` expenses per category (matching currency,
no FX) against the budget amount. Requires `canManageExpenses` to set a
budget, `canAccessCompany` (read-only) to view either report.

## Freelancers

- POST `/freelancers`
- GET `/freelancers`
- GET `/freelancers/:id`

## Contracts

- POST `/contracts`
- GET `/contracts`
- GET `/contracts/:id`
- POST `/contracts/:id/send-for-signature`
- POST `/contracts/:id/mark-signed`

## Forecast

- GET `/forecast?companyId=...&days=30`
- GET `/forecast/group?days=90`

## Reconciliation

- GET `/reconciliation/exceptions`
- POST `/reconciliation/:id/resolve`

## Webhooks

- POST `/webhooks/:provider`

## Error format

```json
{
  "error": {
    "code": "PAYMENT_NOT_APPROVED",
    "message": "Payment must be approved before execution.",
    "requestId": "..."
  }
}
```

Do not expose provider secrets or raw sensitive payloads.
