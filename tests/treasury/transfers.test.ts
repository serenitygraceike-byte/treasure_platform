import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    bankTransfer: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn(), findUniqueOrThrow: vi.fn() },
    bankAccount: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    company: { findUniqueOrThrow: vi.fn() },
  },
}));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/ledger/service", () => ({
  startTransfer: vi.fn(),
  settleTransfer: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import * as ledger from "@/lib/ledger/service";
import { createTransfer, settleTransfer, TransferValidationError } from "@/lib/treasury/transfers";

const sourceAccount = { id: "ba1", companyId: "c1", currency: "EUR" } as never;
const destinationAccount = { id: "ba2", companyId: "c1", currency: "EUR", ledgerAccountAddress: "org:1:company:1:bank:2:EUR" } as never;
const otherCompanyAccount = { id: "ba3", companyId: "c2", currency: "EUR" } as never;
const company = { id: "c1", organizationId: "org1" } as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createTransfer", () => {
  it("rejects transferring a bank account to itself", async () => {
    await expect(
      createTransfer(sourceAccount, {
        destinationAccountId: "ba1",
        amount: "10.00",
        idempotencyKey: "key1",
        actorUserId: "u1",
        correlationId: "corr1",
      })
    ).rejects.toBeInstanceOf(TransferValidationError);
    expect(ledger.startTransfer).not.toHaveBeenCalled();
  });

  it("rejects a destination bank account belonging to a different company", async () => {
    vi.mocked(prisma.bankTransfer.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.bankAccount.findUnique).mockResolvedValueOnce(otherCompanyAccount);

    await expect(
      createTransfer(sourceAccount, {
        destinationAccountId: "ba3",
        amount: "10.00",
        idempotencyKey: "key1",
        actorUserId: "u1",
        correlationId: "corr1",
      })
    ).rejects.toBeInstanceOf(TransferValidationError);
    expect(ledger.startTransfer).not.toHaveBeenCalled();
  });

  it("returns the existing row on a repeated idempotency key without calling the ledger", async () => {
    vi.mocked(prisma.bankTransfer.findUnique).mockResolvedValueOnce({ id: "t1" } as never);

    const result = await createTransfer(sourceAccount, {
      destinationAccountId: "ba2",
      amount: "10.00",
      idempotencyKey: "key1",
      actorUserId: "u1",
      correlationId: "corr1",
    });

    expect(result).toEqual({ id: "t1" });
    expect(ledger.startTransfer).not.toHaveBeenCalled();
  });

  it("calls startTransfer, writes the row, and logs an audit event", async () => {
    vi.mocked(prisma.bankTransfer.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.bankAccount.findUnique).mockResolvedValueOnce(destinationAccount);
    vi.mocked(prisma.company.findUniqueOrThrow).mockResolvedValueOnce(company);
    vi.mocked(ledger.startTransfer).mockResolvedValueOnce({ id: 7 } as never);
    vi.mocked(prisma.bankTransfer.create).mockResolvedValueOnce({ id: "t1", status: "IN_TRANSIT" } as never);

    const result = await createTransfer(sourceAccount, {
      destinationAccountId: "ba2",
      amount: "10.00",
      idempotencyKey: "key1",
      actorUserId: "u1",
      correlationId: "corr1",
    });

    expect(ledger.startTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ bankAccountId: "ba1", asset: "EUR", amount: "10.00" })
    );
    expect(prisma.bankTransfer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ startLedgerTransactionId: "7", destinationAccountId: "ba2" }),
      })
    );
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "bank_transfer.start", objectId: "t1" })
    );
    expect((result as { id: string }).id).toBe("t1");
  });
});

describe("settleTransfer", () => {
  it("returns the transfer unchanged if already settled, without calling the ledger", async () => {
    vi.mocked(prisma.bankTransfer.findUniqueOrThrow).mockResolvedValueOnce({
      id: "t1",
      status: "SETTLED",
    } as never);

    const result = await settleTransfer("t1", { actorUserId: "u1", correlationId: "corr1" });

    expect((result as { status: string }).status).toBe("SETTLED");
    expect(ledger.settleTransfer).not.toHaveBeenCalled();
  });

  it("settles to the destination account's ledger address with a deterministic idempotency key", async () => {
    vi.mocked(prisma.bankTransfer.findUniqueOrThrow).mockResolvedValueOnce({
      id: "t1",
      status: "IN_TRANSIT",
      companyId: "c1",
      destinationAccountId: "ba2",
      currency: "EUR",
      amount: { toString: () => "10.00" },
    } as never);
    vi.mocked(prisma.bankAccount.findUniqueOrThrow).mockResolvedValueOnce(destinationAccount);
    vi.mocked(prisma.company.findUniqueOrThrow).mockResolvedValueOnce(company);
    vi.mocked(ledger.settleTransfer).mockResolvedValueOnce({ id: 8 } as never);
    vi.mocked(prisma.bankTransfer.update).mockResolvedValueOnce({ id: "t1", status: "SETTLED" } as never);

    await settleTransfer("t1", { actorUserId: "u1", correlationId: "corr1" });

    expect(ledger.settleTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationAddress: "org:1:company:1:bank:2:EUR",
        amount: "10.00",
        idempotencyKey: "transfer-settle:t1",
      })
    );
    expect(prisma.bankTransfer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "t1" },
        data: expect.objectContaining({ status: "SETTLED", settleLedgerTransactionId: "8" }),
      })
    );
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "bank_transfer.settle", objectId: "t1" })
    );
  });
});
