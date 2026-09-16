# 06 — Provider Interfaces

MVP does not connect real providers.

Implement interfaces plus a deterministic mock provider.

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
