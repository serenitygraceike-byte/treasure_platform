# 06 — Provider Interfaces

MVP does not connect real payment providers.

Implement interfaces plus a deterministic mock provider.

**Phase 9A exception**: `PIRAEUS_BANK` is a real provider, but only for
the read-only `BankAccountInformationProvider` capability below — it
never implements `BankProvider` and never executes a payment. See
`docs/13-PIRAEUS-PROVIDER.md`.

## BankProvider

```ts
interface BankProvider {
  createTransfer(input: CreateTransferInput): Promise<ProviderPayment>;
  getTransfer(id: string): Promise<ProviderPayment>;
  cancelTransfer(id: string): Promise<void>;
  verifyWebhook(request: Request): Promise<ProviderEvent>;
}
```

## CryptoProvider

```ts
interface CryptoProvider {
  createPayment(input: CreateCryptoPaymentInput): Promise<ProviderPayment>;
  getPayment(id: string): Promise<ProviderPayment>;
  cancelPayment(id: string): Promise<void>;
  verifyWebhook(request: Request): Promise<ProviderEvent>;
}
```

## PayoutProvider

```ts
interface PayoutProvider {
  createPayout(input: CreatePayoutInput): Promise<ProviderPayment>;
  getPayout(id: string): Promise<ProviderPayment>;
  verifyWebhook(request: Request): Promise<ProviderEvent>;
}
```

## SignatureProvider

```ts
interface SignatureProvider {
  createEnvelope(input: CreateSignatureInput): Promise<SignatureEnvelope>;
  getEnvelope(id: string): Promise<SignatureEnvelope>;
  voidEnvelope(id: string): Promise<void>;
}
```

## Mock providers

Required for MVP:
- MockBankProvider
- MockCryptoProvider
- MockPayoutProvider
- MockSignatureProvider

They must simulate:
- success
- pending
- failure
- duplicate webhook
- retry

## BankAccountInformationProvider (Phase 9A — not in the original spec)

Read-only, provider-neutral. Separate from `BankProvider` above on
purpose — `BankProvider` is the payment-execution interface Phase 6
wires to `MOCK_BANK`; this is account *information*, wired to
`PIRAEUS_BANK` in Phase 9A and reusable by a future Alpha Bank/NBG/
Raiffeisen/Mercury/Revolut adapter.

```ts
interface BankAccountInformationProvider {
  listAccounts(connection: { accessToken: string }): Promise<NormalizedAccount[]>;
  getBalances(connection: { accessToken: string }, externalAccountId: string): Promise<NormalizedBalance[]>;
  getTransactions(
    connection: { accessToken: string },
    externalAccountId: string,
    range: { dateFrom: string; dateTo: string }
  ): Promise<NormalizedTransaction[]>;
  getTransactionDetails(
    connection: { accessToken: string },
    externalAccountId: string,
    externalTransactionId: string
  ): Promise<NormalizedTransaction>;
}
```

`NormalizedAccount`/`NormalizedBalance`/`NormalizedTransaction`
(`lib/providers/types.ts`) never carry a provider's raw response shape
or an unmasked account identifier — see `docs/13-PIRAEUS-PROVIDER.md`
"Security controls".
