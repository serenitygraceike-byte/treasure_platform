import { describe, expect, it, beforeAll } from "vitest";
import { mockOutcomeForAmount } from "@/lib/providers/mock-shared";
import { MockBankProvider } from "@/lib/providers/mock-bank";
import { MockCryptoProvider } from "@/lib/providers/mock-crypto";
import { MockPayoutProvider } from "@/lib/providers/mock-payout";

beforeAll(() => {
  process.env.MOCK_PROVIDER_WEBHOOK_SECRET = "test-secret";
});

describe("mockOutcomeForAmount", () => {
  it("fails deterministically on .13", () => {
    expect(mockOutcomeForAmount("100.13")).toBe("FAILED");
  });
  it("is pending deterministically on .66", () => {
    expect(mockOutcomeForAmount("100.66")).toBe("PENDING");
  });
  it("succeeds for any other amount", () => {
    expect(mockOutcomeForAmount("100.00")).toBe("SUCCEEDED");
    expect(mockOutcomeForAmount("42.50")).toBe("SUCCEEDED");
  });
});

describe("MockBankProvider", () => {
  const provider = new MockBankProvider();

  it("createTransfer returns a deterministic outcome and getTransfer round-trips it", async () => {
    const result = await provider.createTransfer({ reference: "p1", amount: "10.13", asset: "EUR", payoutDetails: "IBAN123" });
    expect(result.status).toBe("FAILED");
    expect(result.failureCode).toBe("MOCK_BANK_DECLINED");

    const fetched = await provider.getTransfer(result.providerPaymentId);
    expect(fetched).toEqual(result);
  });

  it("throws for an unknown transfer id", async () => {
    await expect(provider.getTransfer("nope")).rejects.toThrow();
  });

  it("verifyWebhook rejects an unsigned request", async () => {
    const request = new Request("http://internal/webhook", { method: "POST", body: "{}" });
    await expect(provider.verifyWebhook(request)).rejects.toThrow();
  });
});

describe("MockCryptoProvider / MockPayoutProvider", () => {
  it("createPayment succeeds for a plain amount", async () => {
    const provider = new MockCryptoProvider();
    const result = await provider.createPayment({ reference: "p2", amount: "5.00", asset: "USDT", payoutDetails: "0xabc" });
    expect(result.status).toBe("SUCCEEDED");
  });

  it("createPayout is pending for .66", async () => {
    const provider = new MockPayoutProvider();
    const result = await provider.createPayout({ reference: "p3", amount: "5.66", asset: "USD", payoutDetails: "card-123" });
    expect(result.status).toBe("PENDING");
  });
});
