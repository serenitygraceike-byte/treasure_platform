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
