import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { canAccessCompany, canManageExpenses } from "@/lib/rbac";
import { apiError } from "@/lib/api-error";
import { upsertBudgetSchema } from "@/lib/validation/budget";
import { BudgetValidationError, listBudgets, upsertBudget } from "@/lib/expenses/budgets";

// docs/03-API-SPEC.md "Budgets" (Phase 5 -- not in the original spec).
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Sign in required.");

  const { id: companyId } = await params;
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) return apiError(404, "NOT_FOUND", "Company not found.");

  if (!(await canAccessCompany(company.id, company.organizationId, user.id))) {
    return apiError(404, "NOT_FOUND", "Company not found.");
  }

  const url = new URL(request.url);
  const yearParam = url.searchParams.get("periodYear");
  const monthParam = url.searchParams.get("periodMonth");

  const budgets = await listBudgets(
    companyId,
    yearParam ? Number(yearParam) : undefined,
    monthParam ? Number(monthParam) : undefined
  );
  return NextResponse.json(budgets);
}

// Upsert semantics -- no Idempotency-Key header, see lib/expenses/budgets.ts.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Sign in required.");

  const { id: companyId } = await params;
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) return apiError(404, "NOT_FOUND", "Company not found.");

  if (!(await canManageExpenses(company.id, company.organizationId, user.id))) {
    return apiError(403, "FORBIDDEN", "Only ACCOUNTANT, ADMIN or OWNER can set a budget.");
  }

  const body = await request.json().catch(() => null);
  const parsed = upsertBudgetSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid request body.");
  }

  try {
    const budget = await upsertBudget(company, {
      ...parsed.data,
      actorUserId: user.id,
      correlationId: request.headers.get("x-correlation-id") ?? crypto.randomUUID(),
    });
    return NextResponse.json(budget, { status: 201 });
  } catch (err) {
    if (err instanceof BudgetValidationError) return apiError(400, "VALIDATION_ERROR", err.message);
    throw err;
  }
}
