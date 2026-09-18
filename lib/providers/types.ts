// docs/06-PROVIDER-INTERFACES.md defines the method shapes; the payload
// types referenced there (CreateTransferInput, ProviderPayment,
// ProviderEvent, ...) aren't spelled out in the doc, so they're defined
// here, shared by every Mock* implementation in this directory.

export type ProviderOutcome = "SUCCEEDED" | "PENDING" | "FAILED";

export type ProviderPayment = {
  providerPaymentId: string;
  status: ProviderOutcome;
  failureCode?: string;
  failureReason?: string;
};

export type ProviderEvent = {
  externalEventId: string;
  eventType: string;
  providerPaymentId: string;
  status: ProviderOutcome;
  failureCode?: string;
  failureReason?: string;
};

export type CreateTransferInput = {
  reference: string; // Payment.id -- used as the provider-side idempotency key
  amount: string;
  asset: string;
  payoutDetails: string; // decrypted Beneficiary.payoutDetailsEncrypted
};

export class WebhookSignatureError extends Error {}

export interface BankProvider {
  createTransfer(input: CreateTransferInput): Promise<ProviderPayment>;
  getTransfer(id: string): Promise<ProviderPayment>;
  cancelTransfer(id: string): Promise<void>;
  verifyWebhook(request: Request): Promise<ProviderEvent>;
}

export interface CryptoProvider {
  createPayment(input: CreateTransferInput): Promise<ProviderPayment>;
  getPayment(id: string): Promise<ProviderPayment>;
  cancelPayment(id: string): Promise<void>;
  verifyWebhook(request: Request): Promise<ProviderEvent>;
}

export interface PayoutProvider {
  createPayout(input: CreateTransferInput): Promise<ProviderPayment>;
  getPayout(id: string): Promise<ProviderPayment>;
  verifyWebhook(request: Request): Promise<ProviderEvent>;
}

// ---------------------------------------------------------------------
// Phase 9A -- docs/05-MVP-ROADMAP.md Phase 9 "First real provider",
// read-only slice (docs/13-PIRAEUS-PROVIDER.md). A separate capability
// from BankProvider above on purpose: BankProvider is the payment-
// execution interface Phase 6 already wires up to MOCK_BANK, and this
// phase must not touch that routing. BankAccountInformationProvider is
// provider-neutral so a future Alpha Bank/NBG/Raiffeisen/Mercury/
// Revolut adapter can implement it too, reusing the same TreasuryHub
// API surface (app/api/v1/bank-accounts/[id]/...).
//
// Every field here is normalized -- a provider adapter (e.g.
// lib/providers/piraeus/mapper.ts) is the only place that ever sees the
// provider's own raw response shape.
// ---------------------------------------------------------------------

export type NormalizedAccount = {
  externalAccountId: string;
  // Masked (lib/crypto/encryption.ts maskAccountIdentifier) before this
  // ever reaches a log or audit event -- the raw value only exists
  // in-memory and in the DB (ProviderAccountLink.externalAccountId).
  maskedIdentifier: string;
  currency: string;
  name?: string;
};

export type NormalizedBalance = {
  // Free-text, not a fixed union -- the exact balance-type vocabulary
  // PB API Accounts v1.2 returns is unconfirmed (docs/13-PIRAEUS-
  // PROVIDER.md "Assumptions"). Passed through as reported.
  balanceType: string;
  amount: string;
  currency: string;
  observedAt: string;
};

export type NormalizedTransaction = {
  // The provider's own stable id, when supplied -- preserved verbatim.
  // Absent for providers/entries that don't give one; the adapter must
  // still produce `fingerprint` as a fallback dedup key in that case.
  externalTransactionId?: string;
  fingerprint: string;
  bookingDate: string;
  valueDate?: string;
  amount: string;
  currency: string;
  creditDebitIndicator: "CREDIT" | "DEBIT";
  remittanceInfo?: string;
  counterpartyName?: string;
  counterpartyIban?: string;
  providerReferenceCode?: string;
};

export interface BankAccountInformationProvider {
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
