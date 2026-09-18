import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    expenseCategory: { findUnique: vi.fn(), create: vi.fn(), findMany: vi.fn() },
  },
}));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import {
  createExpenseCategory,
  ExpenseCategoryValidationError,
  listExpenseCategories,
} from "@/lib/expenses/categories";

const ctx = { actorUserId: "u1", correlationId: "corr1" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createExpenseCategory", () => {
  it("rejects a parentId from a different organization", async () => {
    vi.mocked(prisma.expenseCategory.findUnique).mockResolvedValueOnce({
      id: "p1",
      organizationId: "org2",
    } as never);

    await expect(
      createExpenseCategory("org1", { code: "HOSTING", name: "Hosting", parentId: "p1" }, ctx)
    ).rejects.toBeInstanceOf(ExpenseCategoryValidationError);
    expect(prisma.expenseCategory.create).not.toHaveBeenCalled();
  });

  it("creates the category and logs an audit event", async () => {
    vi.mocked(prisma.expenseCategory.create).mockResolvedValueOnce({
      id: "c1",
      organizationId: "org1",
      code: "HOSTING",
    } as never);

    const result = await createExpenseCategory("org1", { code: "HOSTING", name: "Hosting" }, ctx);

    expect((result as { id: string }).id).toBe("c1");
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "expense_category.create", objectId: "c1" })
    );
  });
});

describe("listExpenseCategories", () => {
  it("lists categories for an organization ordered by code", async () => {
    vi.mocked(prisma.expenseCategory.findMany).mockResolvedValueOnce([{ id: "c1" }] as never);
    const result = await listExpenseCategories("org1");
    expect(result).toEqual([{ id: "c1" }]);
    expect(prisma.expenseCategory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org1" } })
    );
  });
});
