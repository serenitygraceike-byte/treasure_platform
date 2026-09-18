import { describe, expect, it, vi, beforeAll } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: { provider: { upsert: vi.fn() } },
}));

import { createProviderPayment, providerTypeForPaymentMethod, verifyProviderWebhook } from "@/lib/providers/registry";

beforeAll(() => {
  process.env.MOCK_PROVIDER_WEBHOOK_SECRET = "test-secret";
});

// Phase 9A regression guard: adding PIRAEUS_BANK must not change any
// existing Phase 6 mock payment routing (docs/13-PIRAEUS-PROVIDER.md
// "Preserve Phase 6").
describe("Phase 6 payment routing is unchanged by Phase 9A", () => {
  it("BANK_TRANSFER still routes to MOCK_BANK", () => {
    expect(providerTypeForPaymentMethod("BANK_TRANSFER")).toBe("MOCK_BANK");
  });

  it("CRYPTO_EXCHANGE still routes to MOCK_CRYPTO", () => {
    expect(providerTypeForPaymentMethod("CRYPTO_EXCHANGE")).toBe("MOCK_CRYPTO");
  });

  it("CARD_PAYOUT still routes to MOCK_PAYOUT", () => {
    expect(providerTypeForPaymentMethod("CARD_PAYOUT")).toBe("MOCK_PAYOUT");
  });

  it("MANUAL still has no provider mapping", () => {
    expect(providerTypeForPaymentMethod("MANUAL")).toBeUndefined();
  });

  it("PIRAEUS_BANK is never a payment-method target", () => {
    // No PaymentMethod maps to PIRAEUS_BANK -- it's a
    // BankAccountInformationProvider, not a BankProvider.
    const methods = ["BANK_TRANSFER", "CRYPTO_EXCHANGE", "CARD_PAYOUT", "MANUAL"] as const;
    for (const method of methods) {
      expect(providerTypeForPaymentMethod(method)).not.toBe("PIRAEUS_BANK");
    }
  });
});

describe("PIRAEUS_BANK is explicitly refused by the payment-execution facade", () => {
  it("createProviderPayment throws rather than silently doing nothing", async () => {
    await expect(createProviderPayment("PIRAEUS_BANK", { reference: "r", amount: "1.00", asset: "EUR", payoutDetails: "x" })).rejects.toThrow(
      /does not support payment execution/
    );
  });

  it("verifyProviderWebhook throws rather than silently doing nothing", async () => {
    await expect(verifyProviderWebhook("PIRAEUS_BANK", new Request("http://x", { method: "POST" }))).rejects.toThrow(
      /does not send webhooks/
    );
  });
});
