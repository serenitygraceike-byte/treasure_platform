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

## Piraeus provider connection (Phase 9A — not in the original spec)

- POST `/providers/piraeus/connect`
- GET `/providers/piraeus/callback`

Provider-specific OAuth namespace (the task/spec explicitly allows
this, unlike bank data itself, which stays provider-neutral below).
`connect` requires an org-level `TREASURY_MANAGER`, `ADMIN` or `OWNER`
(`canManageProviderConnections`) and body `{ organizationId,
companyId? }`; returns `{ authorizationUrl }`. `callback` is the
browser redirect target Piraeus itself calls (`code`/`state` query
params, no app auth header) — see docs/13-PIRAEUS-PROVIDER.md for how
`state` is validated without trusting the browser.

## Bank account provider linking & sync (Phase 9A — not in the original spec)

- GET `/bank-accounts/:id/provider-accounts?connectionId=`
- POST `/bank-accounts/:id/link-provider-account`
- POST `/bank-accounts/:id/unlink-provider-account`
- GET `/bank-accounts/:id/external-balance`
- GET `/bank-accounts/:id/external-transactions?limit=`
- POST `/bank-accounts/:id/sync`

Provider-neutral on purpose (docs/13-PIRAEUS-PROVIDER.md "API") — a
future Alpha Bank/NBG/Raiffeisen/Mercury/Revolut adapter reuses this
same surface, keyed by `connectionId`/`ProviderAccountLink`, not a
provider-specific path. `link-provider-account`/`unlink-provider-
account`/`sync` require `TREASURY_MANAGER`/`ADMIN`/`OWNER` on that
company (`canManageTreasury`); `provider-accounts`/`external-balance`/
`external-transactions` are read-only (`external-balance`/
`external-transactions` use `canAccessCompany`; `provider-accounts`,
which calls out to Piraeus, uses `canManageTreasury`). `sync` is rate-
guarded (429 during cooldown, `PIRAEUS_MANUAL_SYNC_COOLDOWN_SECONDS`).
`external-balance` returns a read-only comparison against the Formance
ledger balance, never a write.

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

## Payments (Phase 6)

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

`GET /payments` takes a `companyId` query parameter, same pattern as
`GET /expenses`/`GET /intercompany-transfers`. `POST /payments` requires
`bankAccountId` and `beneficiaryId` in the body (see "Counterparties"
below) and an `Idempotency-Key` header; requester role is
`TREASURY_MANAGER`/`ADMIN`/`OWNER` (`canRequestPayment`). `approve`/
`reject` require `APPROVER`/`ADMIN`/`OWNER` of that company
(`canApprovePayment`, company-scoped — unlike intercompany approval, a
payment never spans two companies). `execute`/`cancel` require
`TREASURY_MANAGER`/`ADMIN`/`OWNER` (`canManageTreasury`, the same
money-moving role set as bank transfers) — deliberately a different
check than approve, per docs/07-SECURITY-AND-AUDIT.md "creator may
request; approver authorizes; execution occurs only after approval".
None of the four sub-actions need `Idempotency-Key` (status-transition
guarded); `execute` is the one exception that's re-callable on purpose —
calling it again on a `FAILED` payment retries (capped at 3 retries,
`lib/payments/payments.ts`), each attempt its own ledger idempotency
key.

## Counterparties (Phase 6 — not in the original spec)

- POST `/counterparties`
- GET `/counterparties`
- POST `/counterparties/:id/beneficiaries`
- GET `/counterparties/:id/beneficiaries`

Org-scoped (`organizationId` body/query param, same split as expense
categories) — a counterparty and its beneficiaries are shared by every
company in the organization. Managing either requires an org-level
`ADMIN`/`OWNER`. A beneficiary's `payoutDetails` is encrypted before
storage and never returned by any read path (see
`docs/01-DATABASE-SPEC.md` `beneficiaries`).

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

## Webhooks (Phase 6)

- POST `/webhooks/:provider`

`:provider` is a `providers.id` (UUID), not a type slug — each org's
auto-provisioned `Provider` row has its own callback URL, so the row id
is what a real callback would encode; the row's own `type` field then
picks the verification/adapter logic (`lib/providers/registry.ts`).
Every delivery is signature-verified and deduplicated by
`(providerId, externalEventId)` per `CLAUDE.md` rule 8
(`lib/providers/webhook.ts`) — an invalid signature is still recorded
(`signatureValid: false`) and returns 401; a duplicate of an
already-`PROCESSED` event returns 200 without reprocessing.

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
