import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    bankReservation: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn(), findUniqueOrThrow: vi.fn() },
    bankAccount: { findUniqueOrThrow: vi.fn() },
    company: { findUniqueOrThrow: vi.fn() },
  },
}));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/ledger/service", () => ({
  reserveFunds: vi.fn(),
  releaseReservation: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import * as ledger from "@/lib/ledger/service";
import { createReservation, releaseReservation } from "@/lib/treasury/reservations";

const bankAccount = { id: "ba1", companyId: "c1", currency: "EUR" } as never;
const company = { id: "c1", organizationId: "org1" } as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createReservation", () => {
  it("returns the existing row without calling the ledger again on a repeated idempotency key", async () => {
    vi.mocked(prisma.bankReservation.findUnique).mockResolvedValueOnce({ id: "r1" } as never);

    const result = await createReservation(bankAccount, {
      amount: "10.00",
      idempotencyKey: "key1",
      actorUserId: "u1",
      correlationId: "corr1",
    });

    expect(result).toEqual({ id: "r1" });
    expect(ledger.reserveFunds).not.toHaveBeenCalled();
    expect(prisma.bankReservation.create).not.toHaveBeenCalled();
  });

  it("calls reserveFunds, writes the row, and logs an audit event", async () => {
    vi.mocked(prisma.bankReservation.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.company.findUniqueOrThrow).mockResolvedValueOnce(company);
    vi.mocked(ledger.reserveFunds).mockResolvedValueOnce({ id: 42 } as never);
    vi.mocked(prisma.bankReservation.create).mockResolvedValueOnce({ id: "r1", status: "ACTIVE" } as never);

    const result = await createReservation(bankAccount, {
      amount: "10.00",
      idempotencyKey: "key1",
      actorUserId: "u1",
      correlationId: "corr1",
    });

    expect(ledger.reserveFunds).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org1",
        companyId: "c1",
        bankAccountId: "ba1",
        asset: "EUR",
        amount: "10.00",
        idempotencyKey: "key1",
        correlationId: "corr1",
      })
    );
    expect(prisma.bankReservation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ledgerTransactionId: "42" }) })
    );
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "bank_reservation.create", objectId: "r1" })
    );
    expect((result as { id: string }).id).toBe("r1");
  });

  it("falls back to the existing row on a concurrent duplicate insert (P2002)", async () => {
    vi.mocked(prisma.bankReservation.findUnique)
      .mockResolvedValueOnce(null) // pre-check: nothing yet
      .mockResolvedValueOnce({ id: "r1", status: "ACTIVE" } as never); // post-P2002 fetch
    vi.mocked(prisma.company.findUniqueOrThrow).mockResolvedValueOnce(company);
    vi.mocked(ledger.reserveFunds).mockResolvedValueOnce({ id: 42 } as never);

    const { Prisma } = await import("../../generated/prisma/client");
    vi.mocked(prisma.bankReservation.create).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "7.10.0" })
    );

    const result = await createReservation(bankAccount, {
      amount: "10.00",
      idempotencyKey: "key1",
      actorUserId: "u1",
      correlationId: "corr1",
    });

    expect((result as { id: string }).id).toBe("r1");
    expect(logAudit).not.toHaveBeenCalled();
  });
});

describe("releaseReservation", () => {
  it("returns the reservation unchanged if already released, without calling the ledger", async () => {
    vi.mocked(prisma.bankReservation.findUniqueOrThrow).mockResolvedValueOnce({
      id: "r1",
      status: "RELEASED",
    } as never);

    const result = await releaseReservation("r1", { actorUserId: "u1", correlationId: "corr1" });

    expect((result as { status: string }).status).toBe("RELEASED");
    expect(ledger.releaseReservation).not.toHaveBeenCalled();
  });

  it("calls releaseReservation with a deterministic idempotency key and updates status", async () => {
    vi.mocked(prisma.bankReservation.findUniqueOrThrow).mockResolvedValueOnce({
      id: "r1",
      status: "ACTIVE",
      bankAccountId: "ba1",
      amount: { toString: () => "10.00" },
    } as never);
    vi.mocked(prisma.bankAccount.findUniqueOrThrow).mockResolvedValueOnce(bankAccount);
    vi.mocked(prisma.company.findUniqueOrThrow).mockResolvedValueOnce(company);
    vi.mocked(ledger.releaseReservation).mockResolvedValueOnce({ id: 99 } as never);
    vi.mocked(prisma.bankReservation.update).mockResolvedValueOnce({ id: "r1", status: "RELEASED" } as never);

    await releaseReservation("r1", { actorUserId: "u1", correlationId: "corr1" });

    expect(ledger.releaseReservation).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "reservation-release:r1", amount: "10.00" })
    );
    expect(prisma.bankReservation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "r1" },
        data: expect.objectContaining({ status: "RELEASED", releaseLedgerTransactionId: "99" }),
      })
    );
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "bank_reservation.release", objectId: "r1" })
    );
  });
});
