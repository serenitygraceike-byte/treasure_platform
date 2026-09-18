import { describe, expect, it, vi, beforeAll, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    counterparty: { create: vi.fn(), findMany: vi.fn() },
    beneficiary: { create: vi.fn(), findMany: vi.fn() },
  },
}));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { createBeneficiary, createCounterparty, listBeneficiaries } from "@/lib/counterparties";

beforeAll(() => {
  process.env.PAYOUT_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

beforeEach(() => {
  vi.clearAllMocks();
});

const ctx = { actorUserId: "u1", correlationId: "corr1" };

describe("createCounterparty", () => {
  it("creates the row and logs an audit event", async () => {
    vi.mocked(prisma.counterparty.create).mockResolvedValueOnce({ id: "cp1" } as never);

    const result = await createCounterparty("org1", { legalName: "Acme Supplier", type: "COMPANY" }, ctx);

    expect((result as { id: string }).id).toBe("cp1");
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "counterparty.create", objectId: "cp1" })
    );
  });
});

describe("createBeneficiary", () => {
  const counterparty = { id: "cp1", organizationId: "org1" };

  it("encrypts the payout details before writing, and never returns the ciphertext", async () => {
    vi.mocked(prisma.beneficiary.create).mockImplementationOnce((async (args: { data: Record<string, unknown> }) => ({
      id: "b1",
      counterpartyId: args.data.counterpartyId,
      paymentMethod: args.data.paymentMethod,
      payoutDetailsEncrypted: args.data.payoutDetailsEncrypted,
    })) as never);

    const result = await createBeneficiary(counterparty, { paymentMethod: "BANK_TRANSFER", payoutDetails: "GR1601101250000000012300695" }, ctx);

    expect(result).not.toHaveProperty("payoutDetailsEncrypted");
    const createCall = vi.mocked(prisma.beneficiary.create).mock.calls[0]![0] as never as { data: { payoutDetailsEncrypted: string } };
    expect(createCall.data.payoutDetailsEncrypted).not.toContain("GR1601101250000000012300695");
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "beneficiary.create" }));
  });
});

describe("listBeneficiaries", () => {
  it("never includes payoutDetailsEncrypted in the result", async () => {
    vi.mocked(prisma.beneficiary.findMany).mockResolvedValueOnce([
      { id: "b1", payoutDetailsEncrypted: "secret-blob" },
    ] as never);

    const result = await listBeneficiaries("cp1");

    expect(result[0]).not.toHaveProperty("payoutDetailsEncrypted");
  });
});
