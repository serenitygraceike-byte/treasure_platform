import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { canAccessCompany } from "@/lib/rbac";
import { apiError } from "@/lib/api-error";
import { budgetPeriodQuerySchema } from "@/lib/validation/budget";
import { getActualVsBudget } from "@/lib/expenses/budgets";

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
  const parsed = budgetPeriodQuerySchema.safeParse({
    periodYear: url.searchParams.get("periodYear"),
    periodMonth: url.searchParams.get("periodMonth"),
  });
  if (!parsed.success) {
    return apiError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "periodYear and periodMonth are required.");
  }

  const report = await getActualVsBudget(companyId, parsed.data.periodYear, parsed.data.periodMonth);
  return NextResponse.json(report);
}
