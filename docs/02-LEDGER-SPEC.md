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
