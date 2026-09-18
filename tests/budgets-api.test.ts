import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/rbac", () => ({
  canAccessCompany: vi.fn(),
  canManageExpenses: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { company: { findUnique: vi.fn() } },
}));
vi.mock("@/lib/expenses/budgets", async () => {
  const actual = await vi.importActual<typeof import("@/lib/expenses/budgets")>("@/lib/expenses/budgets");
  return {
    upsertBudget: vi.fn(),
    listBudgets: vi.fn(),
    getActualVsBudget: vi.fn(),
    BudgetValidationError: actual.BudgetValidationError,
  };
});

import { getCurrentUser } from "@/lib/session";
import { canAccessCompany, canManageExpenses } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { BudgetValidationError, getActualVsBudget, listBudgets, upsertBudget } from "@/lib/expenses/budgets";
import { GET as listBudgetsRoute, POST as upsertBudgetRoute } from "@/app/api/v1/companies/[id]/budgets/route";
import { GET as actualVsBudgetRoute } from "@/app/api/v1/companies/[id]/budgets/actual-vs-budget/route";

const CATEGORY_ID = "11111111-1111-4111-8111-111111111111";
const company = { id: "c1", organizationId: "org1" };

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/v1/companies/:id/budgets", () => {
  const validBody = { categoryId: CATEGORY_ID, periodYear: 2026, periodMonth: 10, amount: "500.00", currency: "EUR" };

  it("rejects a caller who can't manage expenses", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canManageExpenses).mockResolvedValueOnce(false);

    const res = await upsertBudgetRoute(
      new Request("http://localhost/api/v1/companies/c1/budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody),
      }),
      params("c1")
    );

    expect(res.status).toBe(403);
    expect(upsertBudget).not.toHaveBeenCalled();
  });

  it("upserts the budget", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canManageExpenses).mockResolvedValueOnce(true);
    vi.mocked(upsertBudget).mockResolvedValueOnce({ id: "b1" } as never);

    const res = await upsertBudgetRoute(
      new Request("http://localhost/api/v1/companies/c1/budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody),
      }),
      params("c1")
    );

    expect(res.status).toBe(201);
    expect(upsertBudget).toHaveBeenCalledWith(company, expect.objectContaining({ categoryId: CATEGORY_ID }));
  });

  it("translates BudgetValidationError into a 400", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canManageExpenses).mockResolvedValueOnce(true);
    vi.mocked(upsertBudget).mockRejectedValueOnce(new BudgetValidationError("bad category"));

    const res = await upsertBudgetRoute(
      new Request("http://localhost/api/v1/companies/c1/budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody),
      }),
      params("c1")
    );

    expect(res.status).toBe(400);
  });
});

describe("GET /api/v1/companies/:id/budgets", () => {
  it("returns 404 (not 403) without company access", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canAccessCompany).mockResolvedValueOnce(false);

    const res = await listBudgetsRoute(new Request("http://localhost/api/v1/companies/c1/budgets"), params("c1"));

    expect(res.status).toBe(404);
  });

  it("lists budgets for a member", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canAccessCompany).mockResolvedValueOnce(true);
    vi.mocked(listBudgets).mockResolvedValueOnce([{ id: "b1" }] as never);

    const res = await listBudgetsRoute(
      new Request("http://localhost/api/v1/companies/c1/budgets?periodYear=2026&periodMonth=10"),
      params("c1")
    );

    expect(res.status).toBe(200);
    expect(listBudgets).toHaveBeenCalledWith("c1", 2026, 10);
  });
});

describe("GET /api/v1/companies/:id/budgets/actual-vs-budget", () => {
  it("requires periodYear and periodMonth", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canAccessCompany).mockResolvedValueOnce(true);

    const res = await actualVsBudgetRoute(
      new Request("http://localhost/api/v1/companies/c1/budgets/actual-vs-budget"),
      params("c1")
    );

    expect(res.status).toBe(400);
  });

  it("returns the report for a member", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1" } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValueOnce(company as never);
    vi.mocked(canAccessCompany).mockResolvedValueOnce(true);
    vi.mocked(getActualVsBudget).mockResolvedValueOnce([{ categoryId: "cat1" }] as never);

    const res = await actualVsBudgetRoute(
      new Request("http://localhost/api/v1/companies/c1/budgets/actual-vs-budget?periodYear=2026&periodMonth=10"),
      params("c1")
    );

    expect(res.status).toBe(200);
    expect(getActualVsBudget).toHaveBeenCalledWith("c1", 2026, 10);
  });
});
