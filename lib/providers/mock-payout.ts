import crypto from "node:crypto";
import type { CreateTransferInput, PayoutProvider, ProviderPayment } from "./types";
import { mockOutcomeForAmount, verifyMockWebhook } from "./mock-shared";

// docs/06-PROVIDER-INTERFACES.md MockPayoutProvider -- no cancelPayout in
// the interface (payouts, e.g. card payouts, can't be recalled once
// requested). Same deterministic rule as lib/providers/mock-bank.ts.
const store = new Map<string, ProviderPayment>();

export class MockPayoutProvider implements PayoutProvider {
  async createPayout(input: CreateTransferInput): Promise<ProviderPayment> {
    const providerPaymentId = `mock-payout-${crypto.randomUUID()}`;
    const status = mockOutcomeForAmount(input.amount);
    const payment: ProviderPayment = {
      providerPaymentId,
      status,
      ...(status === "FAILED"
        ? { failureCode: "MOCK_PAYOUT_FAILED", failureReason: "Simulated failure (amount ending .13)." }
        : {}),
    };
    store.set(providerPaymentId, payment);
    return payment;
  }

  async getPayout(id: string): Promise<ProviderPayment> {
    const payment = store.get(id);
    if (!payment) throw new Error(`Unknown mock payout "${id}".`);
    return payment;
  }

  async verifyWebhook(request: Request) {
    return verifyMockWebhook(request);
  }
}

export const mockPayoutProvider = new MockPayoutProvider();
