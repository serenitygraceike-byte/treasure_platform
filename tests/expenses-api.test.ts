import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/rbac", () => ({
  isOrgManager: vi.fn(),
  canAccessCompany: vi.fn(),
  canManageExpenses: vi.fn(),
  canApproveExpense: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    membership: { findUnique: vi.fn() },
    company: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/expenses/categories", () => ({
  createExpenseCategory: vi.fn(),
  listExpenseCategories: vi.fn(),
  ExpenseCategoryValidationError: class ExpenseCategoryValidationError extends Error {},
}));
vi.mock("@/lib/expenses/expenses", async () => {
  const actual = await vi.importActual<typeof import("@/lib/expenses/expenses")>("@/lib/expenses/expenses");
  return {
    createExpense: vi.fn(),
    updateExpense: vi.fn(),
    approveExpense: vi.fn(),
    getExpense: vi.fn(),
    listExpenses: vi.fn(),
    ExpenseValidationError: actual.ExpenseValidationError,
  };
});

import { getCurrentUser } from "@/lib/session";
import { canAccessCompany, canApproveExpense, canManageExpenses, isOrgManager } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import {
  createExpenseCategory,
  listExpenseCategories,
  ExpenseCategoryValidationError,
} from "@/lib/expenses/categories";
import {
  approveExpense,
  createExpense,
  ExpenseValidationError,
  getExpense,
  listExpenses,
  updateExpense,
} from "@/lib/expenses/expenses";
import { GET as listCategoriesRoute, POST as createCategoryRoute } from "@/app/api/v1/expense-categories/route";
import { GET as listExpensesRoute, POST as createExpenseRoute } from "@/app/api/v1/expenses/route";
import { GET as getExpenseRoute, PATCH as patchExpenseRoute } from "@/app/api/v1/expenses/[id]/route";
import { POST as approveExpenseRoute } from "@/app/api/v1/expenses/[id]/approve/route";

const CATEGORY_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const company = { id: COMPANY_ID, organizationId: "org1" };

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function postReq(url: string, body: unknown, method = "POST") {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/v1/expense-categories", () => {
  it("rejects a non-org-manager", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(isOrgManager).mockResolvedValueOnce(false);

    const res = await createCategoryRoute(
      postReq("http://localhost/api/v1/expense-categories", { organizationId: "org1", code: "HOSTING", name: "Hosting" })
    );

    expect(res.status).toBe(403);
    expect(createExpenseCategory).not.toHaveBeenCalled();
  });

  it("creates the category", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(isOrgManager).mockResolvedValueOnce(true);
    vi.mocked(createExpenseCategory).mockResolvedValueOnce({ id: "cat1" } as never);

    const res = await createCategoryRoute(
      postReq("http://localhost/api/v1/expense-categories", { organizationId: "org1", code: "HOSTING", name: "Hosting" })
    );

    expect(res.status).toBe(201);
  });

  it("translates ExpenseCategoryValidationError into a 400", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(isOrgManager).mockResolvedValueOnce(true);
    vi.mocked(createExpenseCategory).mockRejectedValueOnce(new ExpenseCategoryValidationError("bad parent"));

    const res = await createCategoryRoute(
      postReq("http://localhost/api/v1/expense-categories", { organizationId: "org1", code: "HOSTING", name: "Hosting" })
    );

    expect(res.status).toBe(400);
  });
});

describe("GET /api/v1/expense-categories", () => {
  it("requires organizationId", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    const res = await listCategoriesRoute(new Request("http://localhost/api/v1/expense-categories"));
    expect(res.status).toBe(400);
  });

  it("lists categories for a member", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.membership.findUnique).mockResolvedValueOnce({ role: "VIEWER" } as never);
    vi.mocked(listExpenseCategories).mockResolvedValueOnce([{ id: "cat1" }] as never);

    const res = await listCategoriesRoute(
      new Request("http://localhost/api/v1/expense-categories?organizationId=org1")
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "cat1" }]);
  });
});

describe("POST /api/v1/expenses", () => {
  const validBody = {
    companyId: COMPANY_ID,
    categoryId: CATEGORY_ID,
    amount: "10.00",
    currency: "EUR",
    recurrence: "ONE_OFF",
    dueDate: "2026-10-01",
  };

  it("rejects a caller who can't manage expenses on the company", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canManageExpenses).mockResolvedValueOnce(false);

    const res = await createExpenseRoute(postReq("http://localhost/api/v1/expenses", validBody));

    expect(res.status).toBe(403);
    expect(createExpense).not.toHaveBeenCalled();
  });

  it("creates the expense", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canManageExpenses).mockResolvedValueOnce(true);
    vi.mocked(createExpense).mockResolvedValueOnce({ id: "e1" } as never);

    const res = await createExpenseRoute(postReq("http://localhost/api/v1/expenses", validBody));

    expect(res.status).toBe(201);
    expect(createExpense).toHaveBeenCalledWith(company, expect.objectContaining({ categoryId: CATEGORY_ID }));
  });

  it("translates ExpenseValidationError into a 400", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canManageExpenses).mockResolvedValueOnce(true);
    vi.mocked(createExpense).mockRejectedValueOnce(new ExpenseValidationError("bad category"));

    const res = await createExpenseRoute(postReq("http://localhost/api/v1/expenses", validBody));

    expect(res.status).toBe(400);
  });
});

describe("GET /api/v1/expenses", () => {
  it("returns 404 (not 403) without company access", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canAccessCompany).mockResolvedValueOnce(false);

    const res = await listExpensesRoute(new Request("http://localhost/api/v1/expenses?companyId=c1"));

    expect(res.status).toBe(404);
  });

  it("lists expenses for a member", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canAccessCompany).mockResolvedValueOnce(true);
    vi.mocked(listExpenses).mockResolvedValueOnce([{ id: "e1" }] as never);

    const res = await listExpensesRoute(new Request("http://localhost/api/v1/expenses?companyId=c1"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "e1" }]);
  });
});

describe("PATCH /api/v1/expenses/:id", () => {
  it("rejects a caller who can't manage expenses", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(getExpense).mockResolvedValueOnce({ id: "e1", companyId: "c1" } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canManageExpenses).mockResolvedValueOnce(false);

    const res = await patchExpenseRoute(
      postReq("http://localhost/api/v1/expenses/e1", { amount: "20.00" }, "PATCH"),
      params("e1")
    );

    expect(res.status).toBe(403);
    expect(updateExpense).not.toHaveBeenCalled();
  });

  it("translates ExpenseValidationError (already approved) into a 400", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(getExpense).mockResolvedValueOnce({ id: "e1", companyId: "c1" } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canManageExpenses).mockResolvedValueOnce(true);
    vi.mocked(updateExpense).mockRejectedValueOnce(new ExpenseValidationError("already approved"));

    const res = await patchExpenseRoute(
      postReq("http://localhost/api/v1/expenses/e1", { amount: "20.00" }, "PATCH"),
      params("e1")
    );

    expect(res.status).toBe(400);
  });

  it("updates the expense", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(getExpense).mockResolvedValueOnce({ id: "e1", companyId: "c1" } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canManageExpenses).mockResolvedValueOnce(true);
    vi.mocked(updateExpense).mockResolvedValueOnce({ id: "e1", amount: "20.00" } as never);

    const res = await patchExpenseRoute(
      postReq("http://localhost/api/v1/expenses/e1", { amount: "20.00" }, "PATCH"),
      params("e1")
    );

    expect(res.status).toBe(200);
  });
});

describe("GET /api/v1/expenses/:id", () => {
  it("returns 404 without company access", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(getExpense).mockResolvedValueOnce({ id: "e1", companyId: "c1" } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canAccessCompany).mockResolvedValueOnce(false);

    const res = await getExpenseRoute(new Request("http://localhost/api/v1/expenses/e1"), params("e1"));

    expect(res.status).toBe(404);
  });
});

describe("POST /api/v1/expenses/:id/approve", () => {
  it("rejects a caller without approver rights on the company", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(getExpense).mockResolvedValueOnce({ id: "e1", companyId: "c1" } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canApproveExpense).mockResolvedValueOnce(false);

    const res = await approveExpenseRoute(
      new Request("http://localhost/api/v1/expenses/e1/approve", { method: "POST" }),
      params("e1")
    );

    expect(res.status).toBe(403);
    expect(approveExpense).not.toHaveBeenCalled();
  });

  it("approves the expense", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(getExpense).mockResolvedValueOnce({ id: "e1", companyId: "c1" } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canApproveExpense).mockResolvedValueOnce(true);
    vi.mocked(approveExpense).mockResolvedValueOnce({ id: "e1", status: "APPROVED" } as never);

    const res = await approveExpenseRoute(
      new Request("http://localhost/api/v1/expenses/e1/approve", { method: "POST" }),
      params("e1")
    );

    expect(res.status).toBe(200);
    expect(approveExpense).toHaveBeenCalledWith("e1", expect.objectContaining({ actorUserId: "u1" }));
  });
});
