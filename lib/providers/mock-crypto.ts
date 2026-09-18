import crypto from "node:crypto";
import type { CreateTransferInput, CryptoProvider, ProviderPayment } from "./types";
import { mockOutcomeForAmount, verifyMockWebhook } from "./mock-shared";

// docs/06-PROVIDER-INTERFACES.md MockCryptoProvider. Same deterministic
// rule and in-memory store as lib/providers/mock-bank.ts.
const store = new Map<string, ProviderPayment>();

export class MockCryptoProvider implements CryptoProvider {
  async createPayment(input: CreateTransferInput): Promise<ProviderPayment> {
    const providerPaymentId = `mock-crypto-${crypto.randomUUID()}`;
    const status = mockOutcomeForAmount(input.amount);
    const payment: ProviderPayment = {
      providerPaymentId,
      status,
      ...(status === "FAILED"
        ? { failureCode: "MOCK_CRYPTO_REJECTED", failureReason: "Simulated rejection (amount ending .13)." }
        : {}),
    };
    store.set(providerPaymentId, payment);
    return payment;
  }

  async getPayment(id: string): Promise<ProviderPayment> {
    const payment = store.get(id);
    if (!payment) throw new Error(`Unknown mock crypto payment "${id}".`);
    return payment;
  }

  async cancelPayment(id: string): Promise<void> {
    store.delete(id);
  }

  async verifyWebhook(request: Request) {
    return verifyMockWebhook(request);
  }
}

export const mockCryptoProvider = new MockCryptoProvider();
