# 13 — Piraeus Bank Provider (Phase 9A, read-only)

## Status

**Phase 9A is implementation only (9A.1).** It is explicitly **not**
considered complete until a real Piraeus rAPId Link sandbox/production
connection has been verified end-to-end (9A.2) — see "Completion
gate" below. Nothing in this phase depends on a real credential to be
built, tested, or deployed; the adapter is fully exercised against
mocked HTTP responses.

## Scope

Read-only account information (AIS-style): OAuth connect, list
authorized accounts, match one to an existing `BankAccount`, observe
balances, synchronize transactions. **No money movement.** Payment
execution stays on `MOCK_BANK` (Phase 6) — this phase does not touch
`BANK_TRANSFER -> MOCK_BANK` routing, `BankProvider`, or `Payment`.

Explicitly out of scope for 9A: initiating transfers, SEPA, monetary
OAuth scopes, approving payments, writing to Formance from bank data,
auto-posting every imported transaction, `reconciliations`
(`docs/01-DATABASE-SPEC.md`), `SignatureProvider`
(`docs/06-PROVIDER-INTERFACES.md`).

## Assumptions (must be confirmed in 9A.2)

`rapidlink.piraeusbank.gr` returned a TLS certificate this environment's
`WebFetch` tool could not verify (`unable to verify the first
certificate`) on every page attempted, including the portal's own
Swagger JSON export. Everything below is either confirmed via
search-indexed snippets (cited) or modeled on the Berlin Group
NextGenPSD2/XS2A shape Piraeus's AIS product is confirmed to implement,
and is marked accordingly. **Nothing here should be trusted as exact
wire format until checked against the live portal/sandbox.**

| Fact | Status |
|---|---|
| OAuth authorize params: `response_type=code&client_id=&redirect_uri=&scope=&state=` | Confirmed (search-indexed rAPId Link docs) |
| Scopes `winbankAccess` / `winbankAccess.info` exist | Confirmed; which one is actually read-only-sufficient is **not** confirmed |
| Base gateway `https://api.rapidlink.piraeusbank.gr/piraeusbank/{environment}` | Confirmed |
| AIS API covers Accounts, Credit Cards, and their transactions | Confirmed |
| `GET /accounts/{account-id}/balances` exists | Confirmed |
| Transaction endpoint takes `dateFrom`/`dateTo`, steers on `bookingStatus` | Confirmed |
| Max 50 transactions/page (PSD2 AIS v3.0, not necessarily PB API Accounts v1.2) | Confirmed for a related but not identical product version |
| Exact JSON field names/casing (`resourceId`, `transactionId`, `entryReference`, `proprietaryBankTransactionCode`, ...) | **Assumed** (Berlin Group shape) — `lib/providers/piraeus/types.ts` |
| Pagination mechanism for transactions | **Assumed** (`_links.next`, Berlin Group convention) |
| Token endpoint path, refresh-token support/behavior | **Assumed** — no token endpoint documentation was reachable |
| Rate limits | **Not found anywhere** — `lib/providers/piraeus/client.ts`'s backoff is a conservative default, not a confirmed number |
| v1.1 → v1.2 change: OTP became transactional | Confirmed, and specifically scoped to monetary/PIS operations — supports that AIS read access shouldn't need SCA/OTP, but this isn't independently confirmed for PB API Accounts v1.2 specifically |

Every one of these is isolated behind `lib/providers/piraeus/` (per
`docs/06-PROVIDER-INTERFACES.md`'s adapter boundary) with a
`TODO(9A.2)` comment at the exact line that will need correcting.

## Completion gate (9A.1 vs 9A.2)

9A.1 (this implementation) is done when: migration deployed, all tests
pass, build passes, no real credential was needed to get here. It is
**not** "Phase 9A complete."

9A.2 (real integration verification, blocked on `PIRAEUS_CLIENT_ID`/
`PIRAEUS_CLIENT_SECRET` being installed on the server through the
existing secret mechanism, never Git) requires, before Phase 9A is
considered done:

- OAuth connection succeeds against the real (sandbox or production)
  Piraeus environment.
- One explicitly selected existing `BankAccount` is linked to one real
  Piraeus account.
- Its balance is observed at least once.
- Its transactions sync idempotently (run twice, second run creates 0
  new rows).
- Any wire-format assumption in the table above that turns out wrong
  is corrected in `lib/providers/piraeus/` and this table updated.

## Architecture

```text
lib/providers/piraeus/
  types.ts       raw Piraeus/Berlin-Group-shaped response types (never escape this directory)
  errors.ts      PiraeusApiError family (401/429/5xx mapped, no raw bodies upward)
  client.ts      thin fetch wrapper: timeout, 429 backoff, 5xx retry, no secret logging
  oauth.ts       authorize URL, OAuthState issue/validate/consume, code exchange, refresh
  connection.ts  getValidAccessToken -- decrypts, refreshes if stale, optimistic-lock safe
  accounts.ts    listAccounts/getBalances/getTransactions/getTransactionDetails HTTP calls
  mapper.ts      raw -> normalized (the only file that reads types.ts's raw shapes)
  provider.ts    implements BankAccountInformationProvider for Piraeus
  service.ts     domain orchestration: connect, link/unlink, observe, sync (audit + tenant checks)
```

`lib/providers/types.ts` gained a second, separate interface,
`BankAccountInformationProvider` (`listAccounts`/`getBalances`/
`getTransactions`/`getTransactionDetails`), alongside the existing
`BankProvider`/`CryptoProvider`/`PayoutProvider` (Phase 6 payment
execution, untouched). Provider-neutral by design — a future Alpha
Bank/NBG/Raiffeisen/Mercury/Revolut adapter implements the same
interface and reuses every route under
`app/api/v1/bank-accounts/[id]/...` unchanged.

## Database (see `docs/01-DATABASE-SPEC.md` for the full column list)

New tables, all additive: `oauth_states`, `provider_connections`,
`provider_account_links`, `balance_observations`,
`external_transactions`, `sync_states`. `ProviderType` gained
`PIRAEUS_BANK`. No existing table's columns changed.

- One `ProviderConnection` per `(organization, Piraeus Provider row)` —
  `Provider` rows are still auto-provisioned per `(org, type)`
  (`lib/providers/registry.ts`), same as the mock providers.
- One `ProviderAccountLink` per `BankAccount`, explicit and one-at-a-
  time (never auto-links every account a connection can see) — a
  partial unique index enforces at most one `ACTIVE` link per
  `BankAccount` (hand-written in the migration; Prisma has no partial-
  unique syntax).
- `ExternalTransaction` dedups on `@@unique([bankAccountId,
  fingerprint])` — `fingerprint` is the provider's own stable
  transaction id when supplied, else a keyed HMAC fallback
  (`lib/crypto/encryption.ts` `fingerprintTransactionFallback`). A
  repeated sync of the same date range always reports 0 new rows the
  second time.
- `BalanceObservation` is purely additive history — nothing reads it
  back into the ledger.

## Balance invariant

`lib/providers/piraeus/service.ts` `compareLatestBalanceToLedger`
reads the latest `BalanceObservation` and the Formance ledger balance
(`lib/treasury/balances.ts`) and returns a comparison object
(`{ providerAmount, ledgerAmount, matches }`). It never writes
anything. There is no code path anywhere in this phase that assigns a
Piraeus-reported number to a Formance account.

## Security controls

- OAuth tokens: AES-256-GCM, `PIRAEUS_TOKEN_ENCRYPTION_KEY` (separate
  from `PAYOUT_ENCRYPTION_KEY` — rotating one never affects the other).
- Account matching: keyed HMAC, `PIRAEUS_FINGERPRINT_KEY`
  (`fingerprintAccountIdentifier`) — never a plain hash (an unkeyed
  hash of an IBAN is brute-forceable; IBANs have far less entropy than
  a real secret).
- `lib/crypto/encryption.ts` `maskAccountIdentifier` (last 4 chars
  only) is the only account-identifier shape allowed in logs/audit
  metadata/error messages.
- `lib/providers/piraeus/client.ts` and `oauth.ts` log method + path +
  HTTP status + duration only — never a response body, header, token,
  or authorization code.
- OAuth `state`: `crypto.randomBytes(32)`, stored server-side
  (`OAuthState`), bound at issuance to `(organizationId, userId,
  companyId?)`, single-use (atomic `updateMany` with `consumedAt:
  null` in the `WHERE` clause — a race loses cleanly), 10-minute TTL.
  The callback (`app/api/v1/providers/piraeus/callback/route.ts`)
  trusts nothing the browser resubmits beyond the opaque `state`
  itself.
- Concurrent token refresh: `ProviderConnection.version` optimistic
  lock (`lib/providers/piraeus/connection.ts`) — a losing concurrent
  refresh discards its own result and re-reads the winner's token
  instead of overwriting it.
- Linking never trusts a client-submitted IBAN: `linkBankAccount`
  re-fetches the account list from Piraeus itself
  (`getRawAccountIdentifier`) and fingerprints *that*, using only the
  client-submitted `externalAccountId` as a selector.
- Tenant scoping: every new table carries `organizationId`
  (`BalanceObservation`/`ExternalTransaction` also carry `companyId`/
  `bankAccountId`), every route re-checks `canAccessCompany`/
  `canManageTreasury`/`canManageProviderConnections` exactly like every
  other route in this codebase.

## RBAC

`canManageProviderConnections(organizationId, userId)` — org-level only
(`OWNER`/`ADMIN`/`TREASURY_MANAGER`), same pattern as
`canApproveIntercompany`: a `ProviderConnection` belongs to the
organization, not one company. Linking/unlinking/syncing a specific
`BankAccount` reuses the existing `canManageTreasury`/`canAccessCompany`
(company-scoped) — no new function needed there.

## Synchronization

`scripts/piraeus-sync-worker.ts` is a separate long-running process
(same image/repo/domain modules as `web` — still a modular monolith,
not a microservice), polling every `ACTIVE` `ProviderAccountLink` on
`PIRAEUS_SYNC_POLL_INTERVAL_SECONDS` (default 900s, conservative —
no published Piraeus rate limit exists to size this against). One
link's failure is isolated and logged; it never stops the rest.
Idempotent and restart-safe by construction (cursor + dedup, not
in-memory state).

The manual "sync now" API route
(`app/api/v1/bank-accounts/[id]/sync/route.ts`) shares the same
`syncLinkFully` and is rate-guarded by
`SyncState.nextAllowedSyncAt` (`PIRAEUS_MANUAL_SYNC_COOLDOWN_SECONDS`,
default 300s) — returns 429 during cooldown.

## Audit events

`piraeus.connection_initiated`, `piraeus.connection_established`,
`piraeus.connection_failed`, `provider_connection.token_refresh`,
`provider_connection.token_refresh_failed`, `piraeus.bank_account_linked`,
`piraeus.bank_account_unlinked`, `piraeus.balance_observed`,
`piraeus.manual_sync`, `piraeus.sync` (worker-driven), `piraeus.sync_failed`.
Metadata is always masked identifiers/counts/ids only — never a raw
account number, token, or provider response body.

## Environment variables

See `.env.example` for the full list and inline documentation:
`PIRAEUS_CLIENT_ID`, `PIRAEUS_CLIENT_SECRET`, `PIRAEUS_ENVIRONMENT`,
`PIRAEUS_BASE_URL`, `PIRAEUS_AUTHORIZE_URL`, `PIRAEUS_TOKEN_URL`,
`PIRAEUS_SCOPE`, `PIRAEUS_REDIRECT_URI`, `PIRAEUS_TOKEN_ENCRYPTION_KEY`,
`PIRAEUS_FINGERPRINT_KEY`, `PIRAEUS_SYNC_POLL_INTERVAL_SECONDS`,
`PIRAEUS_SYNC_LOOKBACK_DAYS`, `PIRAEUS_MANUAL_SYNC_COOLDOWN_SECONDS`.

Per `CLAUDE.md` rule 19 and this phase's own brief: real values for
`PIRAEUS_CLIENT_ID`/`PIRAEUS_CLIENT_SECRET` go on the server through
the existing production secret mechanism
(`docs/11-DEPLOYMENT-WORKFLOW.md`) — never Git, and 9A.1 does not need
them to build, test, or deploy.

## Deployment

Follows `docs/11-DEPLOYMENT-WORKFLOW.md` exactly, plus one addition:
`infrastructure/production/docker-compose.yml` gained a `sync-worker`
service (same image, `builder` stage, same as `migrate`) that must also
be built and started (`docker compose --env-file ../../.env up -d
sync-worker` alongside `web`). It has no health check dependency beyond
Postgres and does not need the credentials set to start — it simply
finds zero `ACTIVE` links and idles until 9A.2 links one.

## Known limitation carried forward

`lib/providers/piraeus/provider.ts`'s `getTransactions`/
`getTransactionDetails` (the generic `BankAccountInformationProvider`
interface methods) use `externalAccountId` as the fingerprint scope
rather than a `bankAccountId`, since the provider-neutral interface
doesn't carry one. This is safe today because
`@@unique([bankAccountId, fingerprint])` is still the actual DB
constraint used by `lib/providers/piraeus/service.ts`'s
`syncTransactions` (which calls `lib/providers/piraeus/accounts.ts`
directly, with the real `bankAccountId`) — the generic interface path
is kept only for interface conformance and isn't on the sync
call path in this phase.
