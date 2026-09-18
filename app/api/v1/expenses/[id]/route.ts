import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { canAccessCompany, canManageExpenses } from "@/lib/rbac";
import { apiError } from "@/lib/api-error";
import { updateExpenseSchema } from "@/lib/validation/expense";
import { ExpenseValidationError, getExpense, updateExpense } from "@/lib/expenses/expenses";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Sign in required.");

  const { id } = await params;
  const expense = await getExpense(id);
  if (!expense) return apiError(404, "NOT_FOUND", "Expense not found.");

  const company = await prisma.company.findUnique({ where: { id: expense.companyId } });
  if (!company || !(await canAccessCompany(company.id, company.organizationId, user.id))) {
    return apiError(404, "NOT_FOUND", "Expense not found.");
  }

  return NextResponse.json(expense);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Sign in required.");

  const { id } = await params;
  const expense = await getExpense(id);
  if (!expense) return apiError(404, "NOT_FOUND", "Expense not found.");

  const company = await prisma.company.findUnique({ where: { id: expense.companyId } });
  if (!company) return apiError(404, "NOT_FOUND", "Expense not found.");

  if (!(await canManageExpenses(company.id, company.organizationId, user.id))) {
    return apiError(403, "FORBIDDEN", "Only ACCOUNTANT, ADMIN or OWNER can edit an expense.");
  }

  const body = await request.json().catch(() => null);
  const parsed = updateExpenseSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid request body.");
  }

  try {
    const updated = await updateExpense(id, {
      ...parsed.data,
      actorUserId: user.id,
      correlationId: request.headers.get("x-correlation-id") ?? crypto.randomUUID(),
    });
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof ExpenseValidationError) return apiError(400, "VALIDATION_ERROR", err.message);
    throw err;
  }
}
