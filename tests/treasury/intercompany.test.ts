import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    intercompanyTransfer: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    bankAccount: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    company: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
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
import {
  approveIntercompanyTransfer,
  createIntercompanyTransfer,
  IntercompanyValidationError,
  reconcileIntercompanyTransfer,
  rejectIntercompanyTransfer,
} from "@/lib/treasury/intercompany";

const sourceAccount = { id: "ba1", companyId: "c1", currency: "EUR" } as never;
const destinationAccount = {
  id: "ba2",
  companyId: "c2",
  currency: "EUR",
  ledgerAccountAddress: "org:1:company:2:bank:2:EUR",
} as never;
const rsdDestinationAccount = { id: "ba3", companyId: "c2", currency: "RSD" } as never;
const fromCompany = { id: "c1", organizationId: "org1" } as never;
const toCompany = { id: "c2", organizationId: "org1" } as never;
const otherOrgCompany = { id: "c3", organizationId: "org2" } as never;

const ctx = { actorUserId: "u1", correlationId: "corr1" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createIntercompanyTransfer", () => {
  it("rejects fromCompanyId === toCompanyId", async () => {
    vi.mocked(prisma.company.findUniqueOrThrow).mockResolvedValueOnce(fromCompany);
    await expect(
      createIntercompanyTransfer(sourceAccount, {
        toCompanyId: "c1",
        destinationAccountId: "ba2",
        amount: "10.00",
        idempotencyKey: "k1",
        ...ctx,
      })
    ).rejects.toBeInstanceOf(IntercompanyValidationError);
    expect(ledger.startTransfer).not.toHaveBeenCalled();
  });

  it("rejects a destination company in a different organization", async () => {
    vi.mocked(prisma.company.findUniqueOrThrow).mockResolvedValueOnce(fromCompany);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(otherOrgCompany);
    await expect(
      createIntercompanyTransfer(sourceAccount, {
        toCompanyId: "c3",
        destinationAccountId: "ba2",
        amount: "10.00",
        idempotencyKey: "k1",
        ...ctx,
      })
    ).rejects.toBeInstanceOf(IntercompanyValidationError);
  });

  it("rejects a destination account not belonging to toCompanyId", async () => {
    vi.mocked(prisma.company.findUniqueOrThrow).mockResolvedValueOnce(fromCompany);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(toCompany);
    vi.mocked(prisma.bankAccount.findUnique).mockResolvedValueOnce({
      id: "ba2",
      companyId: "some-other-company",
      currency: "EUR",
    } as never);
    await expect(
      createIntercompanyTransfer(sourceAccount, {
        toCompanyId: "c2",
        destinationAccountId: "ba2",
        amount: "10.00",
        idempotencyKey: "k1",
        ...ctx,
      })
    ).rejects.toBeInstanceOf(IntercompanyValidationError);
  });

  it("rejects a currency mismatch (no FX)", async () => {
    vi.mocked(prisma.company.findUniqueOrThrow).mockResolvedValueOnce(fromCompany);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(toCompany);
    vi.mocked(prisma.bankAccount.findUnique).mockResolvedValueOnce(rsdDestinationAccount);
    await expect(
      createIntercompanyTransfer(sourceAccount, {
        toCompanyId: "c2",
        destinationAccountId: "ba3",
        amount: "10.00",
        idempotencyKey: "k1",
        ...ctx,
      })
    ).rejects.toThrow(/FX/);
  });

  it("returns the existing row on a repeated idempotency key without touching the ledger", async () => {
    vi.mocked(prisma.company.findUniqueOrThrow).mockResolvedValueOnce(fromCompany);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(toCompany);
    vi.mocked(prisma.bankAccount.findUnique).mockResolvedValueOnce(destinationAccount);
    vi.mocked(prisma.intercompanyTransfer.findUnique).mockResolvedValueOnce({ id: "ic1" } as never);

    const result = await createIntercompanyTransfer(sourceAccount, {
      toCompanyId: "c2",
      destinationAccountId: "ba2",
      amount: "10.00",
      idempotencyKey: "k1",
      ...ctx,
    });

    expect(result).toEqual({ id: "ic1" });
    expect(prisma.intercompanyTransfer.create).not.toHaveBeenCalled();
  });

  it("creates a PENDING_APPROVAL row without calling the ledger, and logs an audit event", async () => {
    vi.mocked(prisma.company.findUniqueOrThrow).mockResolvedValueOnce(fromCompany);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(toCompany);
    vi.mocked(prisma.bankAccount.findUnique).mockResolvedValueOnce(destinationAccount);
    vi.mocked(prisma.intercompanyTransfer.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.intercompanyTransfer.create).mockResolvedValueOnce({
      id: "ic1",
      status: "PENDING_APPROVAL",
    } as never);

    const result = await createIntercompanyTransfer(sourceAccount, {
      toCompanyId: "c2",
      destinationAccountId: "ba2",
      amount: "10.00",
      idempotencyKey: "k1",
      ...ctx,
    });

    expect(ledger.startTransfer).not.toHaveBeenCalled();
    expect(ledger.settleTransfer).not.toHaveBeenCalled();
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "intercompany_transfer.create", objectId: "ic1" })
    );
    expect((result as { status: string }).status).toBe("PENDING_APPROVAL");
  });
});

describe("approveIntercompanyTransfer", () => {
  it("returns unchanged if not PENDING_APPROVAL, without calling the ledger", async () => {
    vi.mocked(prisma.intercompanyTransfer.findUniqueOrThrow).mockResolvedValueOnce({
      id: "ic1",
      status: "APPROVED",
    } as never);
    const result = await approveIntercompanyTransfer("ic1", ctx);
    expect((result as { status: string }).status).toBe("APPROVED");
    expect(ledger.startTransfer).not.toHaveBeenCalled();
  });

  it("calls startTransfer then settleTransfer and stores both ledger transaction ids", async () => {
    vi.mocked(prisma.intercompanyTransfer.findUniqueOrThrow).mockResolvedValueOnce({
      id: "ic1",
      status: "PENDING_APPROVAL",
      organizationId: "org1",
      fromCompanyId: "c1",
      toCompanyId: "c2",
      bankAccountId: "ba1",
      destinationAccountId: "ba2",
      currency: "EUR",
      amount: { toString: () => "10.00" },
    } as never);
    vi.mocked(prisma.bankAccount.findUniqueOrThrow).mockResolvedValueOnce(destinationAccount);
    vi.mocked(ledger.startTransfer).mockResolvedValueOnce({ id: 10 } as never);
    vi.mocked(ledger.settleTransfer).mockResolvedValueOnce({ id: 11 } as never);
    vi.mocked(prisma.intercompanyTransfer.update).mockResolvedValueOnce({
      id: "ic1",
      status: "APPROVED",
    } as never);

    await approveIntercompanyTransfer("ic1", ctx);

    expect(ledger.startTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: "c1", bankAccountId: "ba1", idempotencyKey: "intercompany-start:ic1" })
    );
    expect(ledger.settleTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationAddress: "org:1:company:2:bank:2:EUR",
        idempotencyKey: "intercompany-settle:ic1",
      })
    );
    expect(prisma.intercompanyTransfer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "APPROVED",
          startLedgerTransactionId: "10",
          settleLedgerTransactionId: "11",
        }),
      })
    );
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "intercompany_transfer.approve", objectId: "ic1" })
    );
  });
});

describe("rejectIntercompanyTransfer", () => {
  it("sets status REJECTED without any ledger call", async () => {
    vi.mocked(prisma.intercompanyTransfer.findUniqueOrThrow).mockResolvedValueOnce({
      id: "ic1",
      status: "PENDING_APPROVAL",
      organizationId: "org1",
    } as never);
    vi.mocked(prisma.intercompanyTransfer.update).mockResolvedValueOnce({
      id: "ic1",
      status: "REJECTED",
    } as never);

    await rejectIntercompanyTransfer("ic1", ctx, "not authorized");

    expect(ledger.startTransfer).not.toHaveBeenCalled();
    expect(prisma.intercompanyTransfer.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "REJECTED" }) })
    );
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "intercompany_transfer.reject" })
    );
  });

  it("returns unchanged if not PENDING_APPROVAL", async () => {
    vi.mocked(prisma.intercompanyTransfer.findUniqueOrThrow).mockResolvedValueOnce({
      id: "ic1",
      status: "APPROVED",
    } as never);
    const result = await rejectIntercompanyTransfer("ic1", ctx);
    expect((result as { status: string }).status).toBe("APPROVED");
    expect(prisma.intercompanyTransfer.update).not.toHaveBeenCalled();
  });
});

describe("reconcileIntercompanyTransfer", () => {
  it("is idempotent by reconciledAt, not just status", async () => {
    vi.mocked(prisma.intercompanyTransfer.findUniqueOrThrow).mockResolvedValueOnce({
      id: "ic1",
      status: "APPROVED",
      reconciledAt: new Date(),
    } as never);
    const result = await reconcileIntercompanyTransfer("ic1", ctx);
    expect(prisma.intercompanyTransfer.update).not.toHaveBeenCalled();
    expect((result as { reconciledAt: Date }).reconciledAt).toBeInstanceOf(Date);
  });

  it("rejects reconciling a transfer that was never approved", async () => {
    vi.mocked(prisma.intercompanyTransfer.findUniqueOrThrow).mockResolvedValueOnce({
      id: "ic1",
      status: "PENDING_APPROVAL",
      reconciledAt: null,
    } as never);
    await expect(reconcileIntercompanyTransfer("ic1", ctx)).rejects.toBeInstanceOf(
      IntercompanyValidationError
    );
  });

  it("sets reconciledAt for an approved, not-yet-reconciled transfer", async () => {
    vi.mocked(prisma.intercompanyTransfer.findUniqueOrThrow).mockResolvedValueOnce({
      id: "ic1",
      status: "APPROVED",
      reconciledAt: null,
      organizationId: "org1",
    } as never);
    vi.mocked(prisma.intercompanyTransfer.update).mockResolvedValueOnce({
      id: "ic1",
      reconciledAt: new Date(),
    } as never);

    await reconcileIntercompanyTransfer("ic1", ctx);

    expect(prisma.intercompanyTransfer.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ reconciledAt: expect.any(Date) }) })
    );
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "intercompany_transfer.reconcile" })
    );
  });
});
