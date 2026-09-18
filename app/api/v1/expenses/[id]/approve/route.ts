import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { canApproveExpense } from "@/lib/rbac";
import { apiError } from "@/lib/api-error";
import { approveExpense, getExpense } from "@/lib/expenses/expenses";

export async function POST(
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

  if (!(await canApproveExpense(company.id, company.organizationId, user.id))) {
    return apiError(403, "FORBIDDEN", "Only an APPROVER, ADMIN or OWNER can approve an expense.");
  }

  const updated = await approveExpense(id, {
    actorUserId: user.id,
    correlationId: request.headers.get("x-correlation-id") ?? crypto.randomUUID(),
  });
  return NextResponse.json(updated);
}
