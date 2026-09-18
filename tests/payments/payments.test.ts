import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    payment: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
    company: { findUniqueOrThrow: vi.fn() },
    bankAccount: { findUniqueOrThrow: vi.fn() },
    beneficiary: { findUniqueOrThrow: vi.fn() },
  },
}));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/ledger/service", () => ({
  startTransfer: vi.fn(),
  settleTransfer: vi.fn(),
  reverseTransfer: vi.fn(),
}));
vi.mock("@/lib/crypto/encryption", () => ({ decryptPayoutDetails: vi.fn(() => "decrypted-details") }));
vi.mock("@/lib/providers/registry", () => ({
  createProviderPayment: vi.fn(),
  getOrCreateProvider: vi.fn(),
  providerTypeForPaymentMethod: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import * as ledger from "@/lib/ledger/service";
import { createProviderPayment, getOrCreateProvider, providerTypeForPaymentMethod } from "@/lib/providers/registry";
import {
  approvePayment,
  cancelPayment,
  createPayment,
  executePayment,
  handlePaymentFailed,
  handlePaymentSettled,
  PaymentValidationError,
  rejectPayment,
} from "@/lib/payments/payments";

const ctx = { actorUserId: "u1", correlationId: "corr1" };
const company = { id: "c1", organizationId: "org1" };
const bankAccount = { id: "ba1", companyId: "c1", currency: "EUR" };
const beneficiary = {
  id: "b1",
  counterpartyId: "cp1",
  paymentMethod: "BANK_TRANSFER",
  counterparty: { organizationId: "org1" },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createPayment", () => {
  it("rejects a beneficiary from a different organization", async () => {
    await expect(
      createPayment(company as never, bankAccount as never, { ...beneficiary, counterparty: { organizationId: "org2" } } as never, {
        paymentType: "SUPPLIER",
        paymentMethod: "BANK_TRANSFER",
        amount: "10.00",
        currency: "EUR",
        idempotencyKey: "k1",
        ...ctx,
      })
    ).rejects.toBeInstanceOf(PaymentValidationError);
  });

  it("rejects a paymentMethod mismatch with the beneficiary", async () => {
    await expect(
      createPayment(company as never, bankAccount as never, beneficiary as never, {
        paymentType: "SUPPLIER",
        paymentMethod: "CARD_PAYOUT",
        amount: "10.00",
        currency: "EUR",
        idempotencyKey: "k1",
        ...ctx,
      })
    ).rejects.toBeInstanceOf(PaymentValidationError);
  });

  it("rejects a currency mismatch with the bank account", async () => {
    await expect(
      createPayment(company as never, bankAccount as never, beneficiary as never, {
        paymentType: "SUPPLIER",
        paymentMethod: "BANK_TRANSFER",
        amount: "10.00",
        currency: "USD",
        idempotencyKey: "k1",
        ...ctx,
      })
    ).rejects.toBeInstanceOf(PaymentValidationError);
  });

  it("returns the existing row on a repeated idempotency key", async () => {
    vi.mocked(prisma.payment.findUnique).mockResolvedValueOnce({ id: "p1" } as never);

    const result = await createPayment(company as never, bankAccount as never, beneficiary as never, {
      paymentType: "SUPPLIER",
      paymentMethod: "BANK_TRANSFER",
      amount: "10.00",
      currency: "EUR",
      idempotencyKey: "k1",
      ...ctx,
    });

    expect(result).toEqual({ id: "p1" });
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it("creates a PENDING_APPROVAL payment and logs an audit event", async () => {
    vi.mocked(prisma.payment.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.payment.create).mockResolvedValueOnce({ id: "p1", status: "PENDING_APPROVAL" } as never);

    const result = await createPayment(company as never, bankAccount as never, beneficiary as never, {
      paymentType: "SUPPLIER",
      paymentMethod: "BANK_TRANSFER",
      amount: "10.00",
      currency: "EUR",
      idempotencyKey: "k1",
      ...ctx,
    });

    expect((result as { status: string }).status).toBe("PENDING_APPROVAL");
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "payment.create" }));
  });
});

describe("approvePayment / rejectPayment / cancelPayment", () => {
  it("approve is idempotent past PENDING_APPROVAL", async () => {
    vi.mocked(prisma.payment.findUniqueOrThrow).mockResolvedValueOnce({ id: "p1", status: "APPROVED" } as never);
    const result = await approvePayment("p1", ctx);
    expect(result.status).toBe("APPROVED");
    expect(prisma.payment.update).not.toHaveBeenCalled();
  });

  it("reject sets REJECTED with a reason", async () => {
    vi.mocked(prisma.payment.findUniqueOrThrow).mockResolvedValueOnce({ id: "p1", status: "PENDING_APPROVAL" } as never);
    vi.mocked(prisma.payment.update).mockResolvedValueOnce({ id: "p1", status: "REJECTED" } as never);

    await rejectPayment("p1", ctx, "duplicate request");

    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "REJECTED", failureReason: "duplicate request" }) })
    );
  });

  it("cancel refuses a payment already PROCESSING", async () => {
    vi.mocked(prisma.payment.findUniqueOrThrow).mockResolvedValueOnce({ id: "p1", status: "PROCESSING" } as never);
    await expect(cancelPayment("p1", ctx)).rejects.toBeInstanceOf(PaymentValidationError);
  });

  it("cancel succeeds for an APPROVED, not-yet-executed payment", async () => {
    vi.mocked(prisma.payment.findUniqueOrThrow).mockResolvedValueOnce({ id: "p1", status: "APPROVED" } as never);
    vi.mocked(prisma.payment.update).mockResolvedValueOnce({ id: "p1", status: "CANCELLED" } as never);
    await cancelPayment("p1", ctx);
    expect(prisma.payment.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "CANCELLED" } }));
  });
});

describe("executePayment", () => {
  const approvedPayment = {
    id: "p1",
    status: "APPROVED",
    organizationId: "org1",
    companyId: "c1",
    bankAccountId: "ba1",
    beneficiaryId: "b1",
    currency: "EUR",
    amount: { toString: () => "10.00" },
    paymentMethod: "BANK_TRANSFER",
    retryCount: 0,
  };

  beforeEach(() => {
    vi.mocked(prisma.company.findUniqueOrThrow).mockResolvedValue(company as never);
    vi.mocked(prisma.bankAccount.findUniqueOrThrow).mockResolvedValue(bankAccount as never);
    vi.mocked(prisma.beneficiary.findUniqueOrThrow).mockResolvedValue({ ...beneficiary, payoutDetailsEncrypted: "cipher" } as never);
    vi.mocked(ledger.startTransfer).mockResolvedValue({ id: 1 } as never);
  });

  it("rejects execution of a never-approved payment", async () => {
    vi.mocked(prisma.payment.findUniqueOrThrow).mockResolvedValueOnce({ ...approvedPayment, status: "PENDING_APPROVAL" } as never);
    await expect(executePayment("p1", ctx)).rejects.toBeInstanceOf(PaymentValidationError);
    expect(ledger.startTransfer).not.toHaveBeenCalled();
  });

  it("is idempotent once already PROCESSING", async () => {
    vi.mocked(prisma.payment.findUniqueOrThrow).mockResolvedValueOnce({ ...approvedPayment, status: "PROCESSING" } as never);
    const result = await executePayment("p1", ctx);
    expect((result as { status: string }).status).toBe("PROCESSING");
    expect(ledger.startTransfer).not.toHaveBeenCalled();
  });

  it("MANUAL settles immediately without a provider call", async () => {
    vi.mocked(prisma.payment.findUniqueOrThrow).mockResolvedValueOnce({ ...approvedPayment, paymentMethod: "MANUAL" } as never);
    vi.mocked(ledger.settleTransfer).mockResolvedValueOnce({ id: 2 } as never);
    vi.mocked(prisma.payment.update).mockResolvedValueOnce({ id: "p1", status: "SETTLED" } as never);

    await executePayment("p1", ctx);

    expect(createProviderPayment).not.toHaveBeenCalled();
    expect(ledger.settleTransfer).toHaveBeenCalled();
    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "SETTLED" }) })
    );
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "payment.settle" }));
  });

  it("settles immediately when the provider returns SUCCEEDED", async () => {
    vi.mocked(prisma.payment.findUniqueOrThrow).mockResolvedValueOnce(approvedPayment as never);
    vi.mocked(providerTypeForPaymentMethod).mockReturnValueOnce("MOCK_BANK");
    vi.mocked(getOrCreateProvider).mockResolvedValueOnce({ id: "prov1" } as never);
    vi.mocked(createProviderPayment).mockResolvedValueOnce({ providerPaymentId: "pp1", status: "SUCCEEDED" });
    vi.mocked(ledger.settleTransfer).mockResolvedValueOnce({ id: 2 } as never);
    vi.mocked(prisma.payment.update).mockResolvedValueOnce({ id: "p1", status: "SETTLED" } as never);

    await executePayment("p1", ctx);

    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "SETTLED", providerPaymentId: "pp1" }) })
    );
  });

  it("goes to PROCESSING when the provider returns PENDING, without settling", async () => {
    vi.mocked(prisma.payment.findUniqueOrThrow).mockResolvedValueOnce(approvedPayment as never);
    vi.mocked(providerTypeForPaymentMethod).mockReturnValueOnce("MOCK_BANK");
    vi.mocked(getOrCreateProvider).mockResolvedValueOnce({ id: "prov1" } as never);
    vi.mocked(createProviderPayment).mockResolvedValueOnce({ providerPaymentId: "pp1", status: "PENDING" });
    vi.mocked(prisma.payment.update).mockResolvedValueOnce({ id: "p1", status: "PROCESSING" } as never);

    await executePayment("p1", ctx);

    expect(ledger.settleTransfer).not.toHaveBeenCalled();
    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PROCESSING" }) })
    );
  });

  it("reverses the ledger posting and marks FAILED when the provider returns FAILED", async () => {
    vi.mocked(prisma.payment.findUniqueOrThrow).mockResolvedValueOnce(approvedPayment as never);
    vi.mocked(providerTypeForPaymentMethod).mockReturnValueOnce("MOCK_BANK");
    vi.mocked(getOrCreateProvider).mockResolvedValueOnce({ id: "prov1" } as never);
    vi.mocked(createProviderPayment).mockResolvedValueOnce({
      providerPaymentId: "pp1",
      status: "FAILED",
      failureCode: "X",
      failureReason: "y",
    });
    vi.mocked(ledger.reverseTransfer).mockResolvedValueOnce({ id: 3 } as never);
    vi.mocked(prisma.payment.update).mockResolvedValueOnce({ id: "p1", status: "FAILED" } as never);

    await executePayment("p1", ctx);

    expect(ledger.reverseTransfer).toHaveBeenCalled();
    expect(prisma.payment.update).toHaveBeenCalledWith(
      // First attempt (from APPROVED, not a retry yet) -- retryCount stays
      // 0 after this failure; it only advances on a subsequent retry.
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED", failureCode: "X", retryCount: 0 }) })
    );
  });

  it("refuses to retry past the retry limit", async () => {
    vi.mocked(prisma.payment.findUniqueOrThrow).mockResolvedValueOnce({ ...approvedPayment, status: "FAILED", retryCount: 3 } as never);
    await expect(executePayment("p1", ctx)).rejects.toBeInstanceOf(PaymentValidationError);
    expect(ledger.startTransfer).not.toHaveBeenCalled();
  });

  it("allows a retry from FAILED under the limit", async () => {
    vi.mocked(prisma.payment.findUniqueOrThrow).mockResolvedValueOnce({ ...approvedPayment, status: "FAILED", retryCount: 1 } as never);
    vi.mocked(providerTypeForPaymentMethod).mockReturnValueOnce("MOCK_BANK");
    vi.mocked(getOrCreateProvider).mockResolvedValueOnce({ id: "prov1" } as never);
    vi.mocked(createProviderPayment).mockResolvedValueOnce({ providerPaymentId: "pp2", status: "SUCCEEDED" });
    vi.mocked(ledger.settleTransfer).mockResolvedValueOnce({ id: 4 } as never);
    vi.mocked(prisma.payment.update).mockResolvedValueOnce({ id: "p1", status: "SETTLED" } as never);

    await executePayment("p1", ctx);

    expect(ledger.startTransfer).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "payment-execute:p1:2" }));
  });
});

describe("handlePaymentSettled / handlePaymentFailed (webhook-driven)", () => {
  const processingPayment = {
    id: "p1",
    status: "PROCESSING",
    organizationId: "org1",
    companyId: "c1",
    bankAccountId: "ba1",
    beneficiaryId: "b1",
    currency: "EUR",
    amount: { toString: () => "10.00" },
    retryCount: 0,
  };
  const event = { externalEventId: "evt1", eventType: "payment.succeeded", providerPaymentId: "pp1", status: "SUCCEEDED" as const };

  it("handlePaymentSettled is a no-op if the payment isn't PROCESSING", async () => {
    vi.mocked(prisma.payment.findFirst).mockResolvedValueOnce({ ...processingPayment, status: "SETTLED" } as never);
    await handlePaymentSettled(event, { correlationId: "w1" });
    expect(ledger.settleTransfer).not.toHaveBeenCalled();
  });

  it("handlePaymentSettled settles the ledger and the payment", async () => {
    vi.mocked(prisma.payment.findFirst).mockResolvedValueOnce(processingPayment as never);
    vi.mocked(prisma.beneficiary.findUniqueOrThrow).mockResolvedValueOnce(beneficiary as never);
    vi.mocked(ledger.settleTransfer).mockResolvedValueOnce({ id: 5 } as never);
    vi.mocked(prisma.payment.update).mockResolvedValueOnce({ id: "p1", status: "SETTLED" } as never);

    await handlePaymentSettled(event, { correlationId: "w1" });

    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "SETTLED" }) })
    );
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "payment.settle", metadata: { via: "webhook" } }));
  });

  it("handlePaymentFailed reverses the ledger and increments retryCount", async () => {
    vi.mocked(prisma.payment.findFirst).mockResolvedValueOnce(processingPayment as never);
    vi.mocked(prisma.bankAccount.findUniqueOrThrow).mockResolvedValueOnce(bankAccount as never);
    vi.mocked(ledger.reverseTransfer).mockResolvedValueOnce({ id: 6 } as never);
    vi.mocked(prisma.payment.update).mockResolvedValueOnce({ id: "p1", status: "FAILED" } as never);

    await handlePaymentFailed(
      { externalEventId: "evt2", eventType: "payment.failed", providerPaymentId: "pp1", status: "FAILED", failureCode: "X", failureReason: "y" },
      { correlationId: "w2" }
    );

    expect(ledger.reverseTransfer).toHaveBeenCalled();
    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED", retryCount: 1 }) })
    );
  });
});
