import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import type { Company, Expense } from "../../generated/prisma/client";

type Context = {
  actorUserId: string;
  correlationId?: string;
};

export class ExpenseValidationError extends Error {}

async function requireCategory(organizationId: string, categoryId: string) {
  const category = await prisma.expenseCategory.findUnique({ where: { id: categoryId } });
  if (!category || category.organizationId !== organizationId) {
    throw new ExpenseValidationError("categoryId must be a category in the same organization.");
  }
  return category;
}

export async function createExpense(
  company: Company,
  input: {
    categoryId: string;
    counterpartyId?: string;
    contractId?: string;
    amount: string;
    currency: string;
    recurrence: "ONE_OFF" | "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY";
    dueDate: string;
    budgetAmount?: string;
  } & Context
) {
  await requireCategory(company.organizationId, input.categoryId);

  const expense = await prisma.expense.create({
    data: {
      organizationId: company.organizationId,
      companyId: company.id,
      categoryId: input.categoryId,
      counterpartyId: input.counterpartyId,
      contractId: input.contractId,
      amount: input.amount,
      currency: input.currency,
      recurrence: input.recurrence,
      dueDate: new Date(input.dueDate),
      budgetAmount: input.budgetAmount,
    },
  });

  await logAudit({
    organizationId: company.organizationId,
    actorUserId: input.actorUserId,
    action: "expense.create",
    objectType: "expense",
    objectId: expense.id,
    correlationId: input.correlationId,
    metadata: { amount: input.amount, currency: input.currency, categoryId: input.categoryId },
  });

  return expense;
}

// Only while PENDING_APPROVAL -- an approved expense is immutable, the
// same "financial history doesn't silently change" rule the ledger side
// already applies to postings (CLAUDE.md rule 5).
export async function updateExpense(
  id: string,
  input: {
    categoryId?: string;
    counterpartyId?: string;
    contractId?: string;
    amount?: string;
    currency?: string;
    recurrence?: "ONE_OFF" | "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY";
    dueDate?: string;
    budgetAmount?: string;
  } & Context
) {
  const expense = await prisma.expense.findUniqueOrThrow({ where: { id } });
  if (expense.status !== "PENDING_APPROVAL") {
    throw new ExpenseValidationError("Only a PENDING_APPROVAL expense can be edited.");
  }

  if (input.categoryId) {
    await requireCategory(expense.organizationId, input.categoryId);
  }

  const updated = await prisma.expense.update({
    where: { id },
    data: {
      categoryId: input.categoryId,
      counterpartyId: input.counterpartyId,
      contractId: input.contractId,
      amount: input.amount,
      currency: input.currency,
      recurrence: input.recurrence,
      dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
      budgetAmount: input.budgetAmount,
    },
  });

  await logAudit({
    organizationId: expense.organizationId,
    actorUserId: input.actorUserId,
    action: "expense.update",
    objectType: "expense",
    objectId: id,
    correlationId: input.correlationId,
  });

  return updated;
}

export async function approveExpense(id: string, ctx: Context): Promise<Expense> {
  const expense = await prisma.expense.findUniqueOrThrow({ where: { id } });
  if (expense.status !== "PENDING_APPROVAL") return expense;

  const updated = await prisma.expense.update({
    where: { id },
    data: { status: "APPROVED", approvedBy: ctx.actorUserId, approvedAt: new Date() },
  });

  await logAudit({
    organizationId: expense.organizationId,
    actorUserId: ctx.actorUserId,
    action: "expense.approve",
    objectType: "expense",
    objectId: id,
    correlationId: ctx.correlationId,
  });

  return updated;
}

export async function getExpense(id: string) {
  return prisma.expense.findUnique({ where: { id } });
}

export async function listExpenses(companyId: string) {
  return prisma.expense.findMany({
    where: { companyId },
    orderBy: { dueDate: "desc" },
  });
}
