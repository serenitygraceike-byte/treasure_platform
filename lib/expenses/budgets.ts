import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { Prisma } from "../../generated/prisma/client";
import type { Company } from "../../generated/prisma/client";

type Context = {
  actorUserId: string;
  correlationId?: string;
};

export class BudgetValidationError extends Error {}

function monthRange(periodYear: number, periodMonth: number) {
  const start = new Date(Date.UTC(periodYear, periodMonth - 1, 1));
  const end = new Date(Date.UTC(periodYear, periodMonth, 1));
  return { start, end };
}

// Upsert by the (companyId, categoryId, periodYear, periodMonth) unique
// key -- a budget is a plan number, not a money movement, so repeating
// the same call is a deliberate update, not a duplicate-creation risk
// (no Idempotency-Key header, unlike reservations/transfers).
export async function upsertBudget(
  company: Company,
  input: {
    categoryId: string;
    periodYear: number;
    periodMonth: number;
    amount: string;
    currency: string;
  } & Context
) {
  const category = await prisma.expenseCategory.findUnique({ where: { id: input.categoryId } });
  if (!category || category.organizationId !== company.organizationId) {
    throw new BudgetValidationError("categoryId must be a category in the same organization.");
  }

  const budget = await prisma.budget.upsert({
    where: {
      companyId_categoryId_periodYear_periodMonth: {
        companyId: company.id,
        categoryId: input.categoryId,
        periodYear: input.periodYear,
        periodMonth: input.periodMonth,
      },
    },
    update: { amount: input.amount, currency: input.currency },
    create: {
      organizationId: company.organizationId,
      companyId: company.id,
      categoryId: input.categoryId,
      periodYear: input.periodYear,
      periodMonth: input.periodMonth,
      amount: input.amount,
      currency: input.currency,
    },
  });

  await logAudit({
    organizationId: company.organizationId,
    actorUserId: input.actorUserId,
    action: "budget.upsert",
    objectType: "budget",
    objectId: budget.id,
    correlationId: input.correlationId,
    metadata: {
      categoryId: input.categoryId,
      periodYear: input.periodYear,
      periodMonth: input.periodMonth,
      amount: input.amount,
    },
  });

  return budget;
}

export async function listBudgets(companyId: string, periodYear?: number, periodMonth?: number) {
  return prisma.budget.findMany({
    where: {
      companyId,
      periodYear,
      periodMonth,
    },
    orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }],
    include: { category: true },
  });
}

// "Actual" is the sum of APPROVED expenses in the same company/category/
// calendar-month whose currency matches the budget's -- a PENDING_APPROVAL
// expense is a request, not yet authorized spend, and a currency
// mismatch is excluded rather than summed (no FX conversion, same rule
// docs/02-LEDGER-SPEC.md already applies to intercompany transfers).
export async function getActualVsBudget(companyId: string, periodYear: number, periodMonth: number) {
  const budgets = await prisma.budget.findMany({
    where: { companyId, periodYear, periodMonth },
    include: { category: true },
  });

  const { start, end } = monthRange(periodYear, periodMonth);

  return Promise.all(
    budgets.map(async (budget) => {
      const actual = await prisma.expense.aggregate({
        where: {
          companyId,
          categoryId: budget.categoryId,
          currency: budget.currency,
          status: "APPROVED",
          dueDate: { gte: start, lt: end },
        },
        _sum: { amount: true },
      });

      const actualAmount = actual._sum.amount ?? new Prisma.Decimal(0);

      return {
        categoryId: budget.categoryId,
        categoryName: budget.category.name,
        currency: budget.currency,
        budgetAmount: budget.amount,
        actualAmount,
        variance: budget.amount.minus(actualAmount),
      };
    })
  );
}
