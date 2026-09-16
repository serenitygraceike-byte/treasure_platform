# 02 — Formance Ledger Specification

## Role

Formance Ledger is the authoritative financial posting engine.

Repository:
https://github.com/formancehq/ledger

Documentation:
https://docs.formance.com/

## Version policy

Do not blindly use a beta release in production.

As of the architecture freeze, the upstream releases page shows the latest stable v2.4.12 while v3 is in pre-release/transition. Development may evaluate v3, but the exact production version must be explicitly pinned after compatibility testing.

Repository:
https://github.com/formancehq/ledger/releases

## Ledger account model

Use deterministic addresses.

Proposed convention:

```text
org:{orgId}:company:{companyId}:bank:{bankAccountId}:{asset}
org:{orgId}:company:{companyId}:reserved:{asset}
org:{orgId}:company:{companyId}:in_transit:{asset}
org:{orgId}:company:{companyId}:expense:{category}:{asset}
org:{orgId}:company:{companyId}:payable:{asset}
org:{orgId}:counterparty:{counterpartyId}:{asset}
```

Examples:

```text
org:1:company:gr-a:bank:mercury-eur:EUR
org:1:company:gr-a:reserved:EUR
org:1:company:gr-a:in_transit:EUR
org:1:company:gr-a:expense:hosting:EUR
```

Exact syntax must be normalized before implementation.

## Asset naming

For fiat, use explicit assets such as:
- EUR
- USD
- RSD

For crypto, use explicit assets such as:
- USDT
- USDC

Do not mix assets.

If Formance asset precision notation is used, document it consistently per asset.

## Core posting patterns

### A. Reserve funds

```text
BANK
  -10000 EUR

RESERVED
  +10000 EUR
```

### B. Release reservation

```text
RESERVED
  -10000 EUR

BANK
  +10000 EUR
```

### C. Start external transfer

```text
BANK
  -10000 EUR

IN_TRANSIT
  +10000 EUR
```

### D. Settle to destination

```text
IN_TRANSIT
  -10000 EUR

DESTINATION
  +10000 EUR
```

### E. Expense

Treasury MVP records the cash movement and expense classification separately.

Cash:

```text
BANK
  -2000 EUR
```

Expense classification:

```text
EXPENSE:HOSTING
  +2000 EUR
```

The exact accounting treatment must be reviewed separately if statutory accounting is added.

## Intercompany

For an intercompany transfer:

Source:

```text
Company A / Bank
  -25000 EUR

Company A / In Transit
  +25000 EUR
```

Destination after settlement:

```text
Company A / In Transit
  -25000 EUR

Company B / Bank
  +25000 EUR
```

Application DB separately records the intercompany relationship and settlement.

## Financial invariants

- Every posting transaction must balance.
- Every application payment must reference a ledger transaction.
- A payment cannot be marked SETTLED unless the corresponding financial event has been reconciled.
- A failed external payment must have a defined compensation/reversal path.
- Do not use application-side arithmetic as a substitute for ledger balance queries.

## Ledger adapter

Create:

```text
packages/ledger/
  client/
  accounts/
  postings/
  mapping/
  errors/
  idempotency/
```

The rest of the application talks to `LedgerService`, not directly to Formance HTTP endpoints.

## Deployment

Formance's current official docs state that production self-hosting is supported through its Kubernetes operator deployment mode. For local development, the upstream repository provides an all-in-one Docker setup.

Therefore:
- local dev: Docker Compose
- initial production: evaluate whether the VPS should run Kubernetes for Formance or use Formance Cloud
- do not improvise an unsupported production Formance deployment

This deployment decision must be made before production money is processed.

## Implementation notes (Phase 2)

- Code lives at `lib/ledger/` (`client.ts`, `accounts.ts`, `postings.ts`, `money.ts`, `errors.ts`, `idempotency.ts`, `service.ts`), not `packages/ledger/` as first sketched above — the repo has no `packages/` workspace, and Phase 0/1 already put every adapter under `lib/`. Same sub-areas, flat files instead of a nested package.
- No third-party Formance SDK dependency — `lib/ledger/client.ts` is a small typed `fetch` wrapper against the v2 REST API, since no vetted TypeScript/Node SDK exists (only Go/Python are officially published).
- One Formance ledger per app instance, named by `FORMANCE_STACK` (`treasury-dev` locally). All organizations/companies share it, namespaced through the account address, so no per-tenant ledger provisioning exists.
- Local dev pins `ghcr.io/formancehq/ledger:v2.4.12` (Decision 5, `docs/10-DECISIONS.md`) via `infrastructure/docker/docker-compose.dev.yml`, with its own Postgres instance separate from the app database.
- Account addresses: UUIDs contain hyphens, which are not valid in a Formance address (`^\w+(:\w+)*$`), so every id segment is sanitized (hyphens stripped) before being joined — see `lib/ledger/accounts.ts`.
- Asset precision (decimal places converted to/from Formance's integer minor units) is a fixed table in `lib/ledger/money.ts`: EUR/USD/RSD = 2, USDT/USDC = 6. Add new assets there, not ad hoc at call sites.
- Idempotency: `lib/ledger/service.ts` requires an idempotency key on every money-moving call and passes it straight through as Formance's native `Idempotency-Key` header — no separate idempotency store in the app database, since Formance already guarantees "same key ⇒ same result".
- No API routes and no `logAudit` calls were added in this phase — Phase 2's acceptance criteria are library-level. Audit coverage for ledger operations arrives with the Phase 3+ routes that call `lib/ledger/service.ts`, the same way `app/api/v1/companies/route.ts` pairs Prisma writes with `logAudit` today.
- **Found by live smoke-testing against v2.4.12, not in the published docs**: `GET /v2/{ledger}/accounts/{address}` omits `volumes` entirely unless called with `?expand=volumes` — Formance's own example response shows `volumes` unconditionally, which does not match this version's actual behavior. `lib/ledger/client.ts`'s `getAccount()` always passes `expand=volumes`; `FormanceAccount.volumes` is typed optional and `lib/ledger/service.ts`'s `getAccountBalance()` defaults a missing volume to zero, in case a future version reintroduces the same omission for an unfunded account.
- Deployed to production 2026-09-16 (`infrastructure/production/docker-compose.yml`, ledger name `treasury-prod`) and smoke-tested end-to-end against the real instance: ledger creation, `world → smoketest:bank` funding, `smoketest:bank → smoketest:reserved` reservation, a repeated `Idempotency-Key` (confirmed `Idempotency-Hit: true`, no double posting), and balance reads. The `smoketest:*` accounts are harmless leftover test data (won't collide with the `org:...:company:...` address convention) — left in place as a working proof rather than reset.
