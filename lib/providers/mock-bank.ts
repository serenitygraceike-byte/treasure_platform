import crypto from "node:crypto";
import type { BankProvider, CreateTransferInput, ProviderPayment } from "./types";
import { mockOutcomeForAmount, verifyMockWebhook } from "./mock-shared";

// docs/06-PROVIDER-INTERFACES.md MockBankProvider. In-memory only -- a
// mock has no real external system to persist to, and this MVP doesn't
// need the mock's own state to survive a restart (lib/payments/
// payments.ts is the source of truth for a Payment's status either way).
const store = new Map<string, ProviderPayment>();

export class MockBankProvider implements BankProvider {
  async createTransfer(input: CreateTransferInput): Promise<ProviderPayment> {
    const providerPaymentId = `mock-bank-${crypto.randomUUID()}`;
    const status = mockOutcomeForAmount(input.amount);
    const payment: ProviderPayment = {
      providerPaymentId,
      status,
      ...(status === "FAILED"
        ? { failureCode: "MOCK_BANK_DECLINED", failureReason: "Simulated decline (amount ending .13)." }
        : {}),
    };
    store.set(providerPaymentId, payment);
    return payment;
  }

  async getTransfer(id: string): Promise<ProviderPayment> {
    const payment = store.get(id);
    if (!payment) throw new Error(`Unknown mock bank transfer "${id}".`);
    return payment;
  }

  async cancelTransfer(id: string): Promise<void> {
    store.delete(id);
  }

  async verifyWebhook(request: Request) {
    return verifyMockWebhook(request);
  }
}

export const mockBankProvider = new MockBankProvider();
