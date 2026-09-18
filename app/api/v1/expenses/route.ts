import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { canAccessCompany, canManageExpenses } from "@/lib/rbac";
import { apiError } from "@/lib/api-error";
import { createExpenseSchema } from "@/lib/validation/expense";
import { createExpense, ExpenseValidationError, listExpenses } from "@/lib/expenses/expenses";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Sign in required.");

  const companyId = new URL(request.url).searchParams.get("companyId");
  if (!companyId) {
    return apiError(400, "MISSING_COMPANY_ID", "companyId query parameter is required.");
  }

  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) return apiError(404, "NOT_FOUND", "Company not found.");

  if (!(await canAccessCompany(company.id, company.organizationId, user.id))) {
    return apiError(404, "NOT_FOUND", "Company not found.");
  }

  const expenses = await listExpenses(companyId);
  return NextResponse.json(expenses);
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Sign in required.");

  const body = await request.json().catch(() => null);
  const parsed = createExpenseSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid request body.");
  }

  const company = await prisma.company.findUnique({ where: { id: parsed.data.companyId } });
  if (!company) return apiError(404, "NOT_FOUND", "Company not found.");

  if (!(await canManageExpenses(company.id, company.organizationId, user.id))) {
    return apiError(403, "FORBIDDEN", "Only ACCOUNTANT, ADMIN or OWNER can record an expense.");
  }

  try {
    const expense = await createExpense(company, {
      categoryId: parsed.data.categoryId,
      counterpartyId: parsed.data.counterpartyId,
      contractId: parsed.data.contractId,
      amount: parsed.data.amount,
      currency: parsed.data.currency,
      recurrence: parsed.data.recurrence,
      dueDate: parsed.data.dueDate,
      budgetAmount: parsed.data.budgetAmount,
      actorUserId: user.id,
      correlationId: request.headers.get("x-correlation-id") ?? crypto.randomUUID(),
    });
    return NextResponse.json(expense, { status: 201 });
  } catch (err) {
    if (err instanceof ExpenseValidationError) return apiError(400, "VALIDATION_ERROR", err.message);
    throw err;
  }
}
