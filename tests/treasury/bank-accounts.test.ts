import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    bankAccount: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { bankAddress, sanitizeSegment } from "@/lib/ledger/accounts";
import { createBankAccount, listBankAccounts, updateBankAccount } from "@/lib/treasury/bank-accounts";

const ORG_ID = "11111111-1111-4111-8111-000000000001";
const COMPANY_ID = "22222222-2222-4222-8222-000000000002";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createBankAccount", () => {
  it("computes a deterministic ledger address matching the created row's own id", async () => {
    vi.mocked(prisma.bankAccount.create).mockResolvedValueOnce({ id: "placeholder" } as never);

    await createBankAccount({
      organizationId: ORG_ID,
      companyId: COMPANY_ID,
      name: "Main Account",
      bankName: "Piraeus Bank",
      currency: "EUR",
    });

    expect(prisma.bankAccount.create).toHaveBeenCalledTimes(1);
    const call = vi.mocked(prisma.bankAccount.create).mock.calls[0]![0] as {
      data: { id: string; ledgerAccountAddress: string };
    };
    const expectedAddress = bankAddress(ORG_ID, COMPANY_ID, call.data.id, "EUR");
    expect(call.data.ledgerAccountAddress).toBe(expectedAddress);
    expect(expectedAddress).toMatch(/^\w+(:\w+)*$/);
    expect(expectedAddress).toContain(sanitizeSegment(ORG_ID));
  });
});

describe("listBankAccounts", () => {
  it("filters by companyId, oldest first", async () => {
    vi.mocked(prisma.bankAccount.findMany).mockResolvedValueOnce([]);
    await listBankAccounts(COMPANY_ID);
    expect(prisma.bankAccount.findMany).toHaveBeenCalledWith({
      where: { companyId: COMPANY_ID },
      orderBy: { createdAt: "asc" },
    });
  });
});

describe("updateBankAccount", () => {
  it("passes the partial update straight through to prisma", async () => {
    vi.mocked(prisma.bankAccount.update).mockResolvedValueOnce({ id: "ba1" } as never);
    await updateBankAccount("ba1", { status: "INACTIVE" });
    expect(prisma.bankAccount.update).toHaveBeenCalledWith({
      where: { id: "ba1" },
      data: { status: "INACTIVE" },
    });
  });
});
