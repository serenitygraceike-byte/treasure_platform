import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    expense: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findMany: vi.fn() },
    expenseCategory: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import {
  approveExpense,
  createExpense,
  ExpenseValidationError,
  updateExpense,
} from "@/lib/expenses/expenses";

const company = { id: "c1", organizationId: "org1" } as never;
const ctx = { actorUserId: "u1", correlationId: "corr1" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createExpense", () => {
  it("rejects a categoryId from a different organization", async () => {
    vi.mocked(prisma.expenseCategory.findUnique).mockResolvedValueOnce({
      id: "cat1",
      organizationId: "org2",
    } as never);

    await expect(
      createExpense(company, {
        categoryId: "cat1",
        amount: "10.00",
        currency: "EUR",
        recurrence: "ONE_OFF",
        dueDate: "2026-10-01",
        ...ctx,
      })
    ).rejects.toBeInstanceOf(ExpenseValidationError);
    expect(prisma.expense.create).not.toHaveBeenCalled();
  });

  it("creates a PENDING_APPROVAL expense and logs an audit event", async () => {
    vi.mocked(prisma.expenseCategory.findUnique).mockResolvedValueOnce({
      id: "cat1",
      organizationId: "org1",
    } as never);
    vi.mocked(prisma.expense.create).mockResolvedValueOnce({
      id: "e1",
      status: "PENDING_APPROVAL",
    } as never);

    const result = await createExpense(company, {
      categoryId: "cat1",
      amount: "10.00",
      currency: "EUR",
      recurrence: "MONTHLY",
      dueDate: "2026-10-01",
      ...ctx,
    });

    expect((result as { status: string }).status).toBe("PENDING_APPROVAL");
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "expense.create", objectId: "e1" })
    );
  });
});

describe("updateExpense", () => {
  it("rejects editing an APPROVED expense", async () => {
    vi.mocked(prisma.expense.findUniqueOrThrow).mockResolvedValueOnce({
      id: "e1",
      status: "APPROVED",
    } as never);

    await expect(updateExpense("e1", { amount: "20.00", ...ctx })).rejects.toBeInstanceOf(
      ExpenseValidationError
    );
    expect(prisma.expense.update).not.toHaveBeenCalled();
  });

  it("updates a PENDING_APPROVAL expense", async () => {
    vi.mocked(prisma.expense.findUniqueOrThrow).mockResolvedValueOnce({
      id: "e1",
      status: "PENDING_APPROVAL",
      organizationId: "org1",
    } as never);
    vi.mocked(prisma.expense.update).mockResolvedValueOnce({ id: "e1", amount: "20.00" } as never);

    await updateExpense("e1", { amount: "20.00", ...ctx });

    expect(prisma.expense.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: "20.00" }) })
    );
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "expense.update" }));
  });
});

describe("approveExpense", () => {
  it("returns unchanged if not PENDING_APPROVAL", async () => {
    vi.mocked(prisma.expense.findUniqueOrThrow).mockResolvedValueOnce({
      id: "e1",
      status: "APPROVED",
    } as never);

    const result = await approveExpense("e1", ctx);

    expect(result.status).toBe("APPROVED");
    expect(prisma.expense.update).not.toHaveBeenCalled();
  });

  it("sets status APPROVED with approvedBy/approvedAt and logs an audit event", async () => {
    vi.mocked(prisma.expense.findUniqueOrThrow).mockResolvedValueOnce({
      id: "e1",
      status: "PENDING_APPROVAL",
      organizationId: "org1",
    } as never);
    vi.mocked(prisma.expense.update).mockResolvedValueOnce({ id: "e1", status: "APPROVED" } as never);

    await approveExpense("e1", ctx);

    expect(prisma.expense.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "APPROVED", approvedBy: "u1", approvedAt: expect.any(Date) }),
      })
    );
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "expense.approve", objectId: "e1" })
    );
  });
});
