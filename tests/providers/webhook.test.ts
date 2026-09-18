import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    provider: { findUnique: vi.fn() },
    webhook: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("@/lib/providers/registry", () => ({ verifyProviderWebhook: vi.fn() }));
vi.mock("@/lib/payments/payments", () => ({
  handlePaymentSettled: vi.fn(),
  handlePaymentFailed: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { verifyProviderWebhook } from "@/lib/providers/registry";
import { handlePaymentFailed, handlePaymentSettled } from "@/lib/payments/payments";
import { WebhookSignatureError } from "@/lib/providers/types";
import { receiveProviderWebhook, WebhookNotFoundError } from "@/lib/providers/webhook";

const provider = { id: "prov1", type: "MOCK_BANK" };

function req(body: string) {
  return new Request("http://internal/webhook", { method: "POST", body });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("receiveProviderWebhook", () => {
  it("throws WebhookNotFoundError for an unknown provider", async () => {
    vi.mocked(prisma.provider.findUnique).mockResolvedValueOnce(null);
    await expect(receiveProviderWebhook("nope", req("{}"))).rejects.toBeInstanceOf(WebhookNotFoundError);
  });

  it("records an ERROR row and rethrows on an invalid signature", async () => {
    vi.mocked(prisma.provider.findUnique).mockResolvedValueOnce(provider as never);
    vi.mocked(verifyProviderWebhook).mockRejectedValueOnce(new WebhookSignatureError("bad sig"));
    vi.mocked(prisma.webhook.create).mockResolvedValueOnce({ id: "w1" } as never);

    await expect(receiveProviderWebhook("prov1", req("{}"))).rejects.toBeInstanceOf(WebhookSignatureError);

    expect(prisma.webhook.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ signatureValid: false, status: "ERROR" }) })
    );
  });

  it("ignores a duplicate already-PROCESSED event without reprocessing", async () => {
    vi.mocked(prisma.provider.findUnique).mockResolvedValueOnce(provider as never);
    vi.mocked(verifyProviderWebhook).mockResolvedValueOnce({
      externalEventId: "evt1",
      eventType: "payment.succeeded",
      providerPaymentId: "pp1",
      status: "SUCCEEDED",
    });
    vi.mocked(prisma.webhook.findUnique).mockResolvedValueOnce({ id: "w1", status: "PROCESSED" } as never);

    const result = await receiveProviderWebhook("prov1", req("{}"));

    expect(result.duplicate).toBe(true);
    expect(handlePaymentSettled).not.toHaveBeenCalled();
    expect(prisma.webhook.create).not.toHaveBeenCalled();
  });

  it("dispatches to handlePaymentSettled for a SUCCEEDED event and marks PROCESSED", async () => {
    vi.mocked(prisma.provider.findUnique).mockResolvedValueOnce(provider as never);
    vi.mocked(verifyProviderWebhook).mockResolvedValueOnce({
      externalEventId: "evt2",
      eventType: "payment.succeeded",
      providerPaymentId: "pp1",
      status: "SUCCEEDED",
    });
    vi.mocked(prisma.webhook.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.webhook.create).mockResolvedValueOnce({ id: "w2" } as never);

    const result = await receiveProviderWebhook("prov1", req("{}"));

    expect(handlePaymentSettled).toHaveBeenCalled();
    expect(handlePaymentFailed).not.toHaveBeenCalled();
    expect(prisma.webhook.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "w2" }, data: expect.objectContaining({ status: "PROCESSED" }) })
    );
    expect(result.duplicate).toBe(false);
  });

  it("retries a previously ERROR-ed event instead of skipping it", async () => {
    vi.mocked(prisma.provider.findUnique).mockResolvedValueOnce(provider as never);
    vi.mocked(verifyProviderWebhook).mockResolvedValueOnce({
      externalEventId: "evt3",
      eventType: "payment.failed",
      providerPaymentId: "pp1",
      status: "FAILED",
      failureCode: "X",
      failureReason: "y",
    });
    vi.mocked(prisma.webhook.findUnique).mockResolvedValueOnce({ id: "w3", status: "ERROR" } as never);
    vi.mocked(prisma.webhook.update).mockResolvedValueOnce({ id: "w3" } as never);

    const result = await receiveProviderWebhook("prov1", req("{}"));

    expect(handlePaymentFailed).toHaveBeenCalled();
    expect(result.duplicate).toBe(false);
  });

  it("marks the row ERROR and rethrows if the downstream handler throws", async () => {
    vi.mocked(prisma.provider.findUnique).mockResolvedValueOnce(provider as never);
    vi.mocked(verifyProviderWebhook).mockResolvedValueOnce({
      externalEventId: "evt4",
      eventType: "payment.succeeded",
      providerPaymentId: "pp1",
      status: "SUCCEEDED",
    });
    vi.mocked(prisma.webhook.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.webhook.create).mockResolvedValueOnce({ id: "w4" } as never);
    vi.mocked(handlePaymentSettled).mockRejectedValueOnce(new Error("ledger down"));

    await expect(receiveProviderWebhook("prov1", req("{}"))).rejects.toThrow("ledger down");

    expect(prisma.webhook.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "w4" }, data: expect.objectContaining({ status: "ERROR" }) })
    );
  });
});
