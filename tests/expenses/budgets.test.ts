import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    budget: { upsert: vi.fn(), findMany: vi.fn() },
    expenseCategory: { findUnique: vi.fn() },
    expense: { aggregate: vi.fn() },
  },
}));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { Prisma } from "../../generated/prisma/client";
import { BudgetValidationError, getActualVsBudget, upsertBudget } from "@/lib/expenses/budgets";

const company = { id: "c1", organizationId: "org1" } as never;
const ctx = { actorUserId: "u1", correlationId: "corr1" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("upsertBudget", () => {
  it("rejects a categoryId from a different organization", async () => {
    vi.mocked(prisma.expenseCategory.findUnique).mockResolvedValueOnce({
      id: "cat1",
      organizationId: "org2",
    } as never);

    await expect(
      upsertBudget(company, {
        categoryId: "cat1",
        periodYear: 2026,
        periodMonth: 10,
        amount: "500.00",
        currency: "EUR",
        ...ctx,
      })
    ).rejects.toBeInstanceOf(BudgetValidationError);
    expect(prisma.budget.upsert).not.toHaveBeenCalled();
  });

  it("upserts by (companyId, categoryId, periodYear, periodMonth) and logs an audit event", async () => {
    vi.mocked(prisma.expenseCategory.findUnique).mockResolvedValueOnce({
      id: "cat1",
      organizationId: "org1",
    } as never);
    vi.mocked(prisma.budget.upsert).mockResolvedValueOnce({ id: "b1" } as never);

    await upsertBudget(company, {
      categoryId: "cat1",
      periodYear: 2026,
      periodMonth: 10,
      amount: "500.00",
      currency: "EUR",
      ...ctx,
    });

    expect(prisma.budget.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId_categoryId_periodYear_periodMonth: {
            companyId: "c1",
            categoryId: "cat1",
            periodYear: 2026,
            periodMonth: 10,
          },
        },
      })
    );
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "budget.upsert", objectId: "b1" }));
  });
});

describe("getActualVsBudget", () => {
  it("sums matching APPROVED expenses within the calendar month and computes variance", async () => {
    vi.mocked(prisma.budget.findMany).mockResolvedValueOnce([
      {
        categoryId: "cat1",
        category: { name: "Hosting" },
        currency: "EUR",
        amount: new Prisma.Decimal("500.00"),
      },
    ] as never);
    vi.mocked(prisma.expense.aggregate).mockResolvedValueOnce({
      _sum: { amount: new Prisma.Decimal("300.00") },
    } as never);

    const [row] = await getActualVsBudget("c1", 2026, 10);

    expect(prisma.expense.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: "c1",
          categoryId: "cat1",
          currency: "EUR",
          status: "APPROVED",
          dueDate: { gte: new Date(Date.UTC(2026, 9, 1)), lt: new Date(Date.UTC(2026, 10, 1)) },
        }),
      })
    );
    expect(row!.actualAmount.toString()).toBe("300");
    expect(row!.variance.toString()).toBe("200");
  });

  it("defaults actual to zero when there are no matching expenses", async () => {
    vi.mocked(prisma.budget.findMany).mockResolvedValueOnce([
      {
        categoryId: "cat1",
        category: { name: "Hosting" },
        currency: "EUR",
        amount: new Prisma.Decimal("500.00"),
      },
    ] as never);
    vi.mocked(prisma.expense.aggregate).mockResolvedValueOnce({ _sum: { amount: null } } as never);

    const [row] = await getActualVsBudget("c1", 2026, 10);

    expect(row!.actualAmount.toString()).toBe("0");
    expect(row!.variance.toString()).toBe("500");
  });
});
