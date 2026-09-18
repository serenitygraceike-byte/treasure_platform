import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { isOrgManager } from "@/lib/rbac";
import { apiError } from "@/lib/api-error";
import { createExpenseCategorySchema } from "@/lib/validation/expense";
import {
  createExpenseCategory,
  ExpenseCategoryValidationError,
  listExpenseCategories,
} from "@/lib/expenses/categories";

// docs/03-API-SPEC.md "Expense categories" (Phase 5 -- not in the
// original spec). Org-scoped, same as memberships -- categories are
// shared by every company in the organization (docs/01-DATABASE-SPEC.md
// expense_categories.organization_id).
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Sign in required.");

  const organizationId = new URL(request.url).searchParams.get("organizationId");
  if (!organizationId) {
    return apiError(400, "MISSING_ORGANIZATION_ID", "organizationId query parameter is required.");
  }

  const membership = await prisma.membership.findUnique({
    where: { organizationId_userId: { organizationId, userId: user.id } },
  });
  if (!membership) return apiError(404, "NOT_FOUND", "Organization not found.");

  const categories = await listExpenseCategories(organizationId);
  return NextResponse.json(categories);
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Sign in required.");

  const body = await request.json().catch(() => null);
  const organizationId = body && typeof body === "object" ? (body as Record<string, unknown>).organizationId : null;
  if (typeof organizationId !== "string") {
    return apiError(400, "VALIDATION_ERROR", "organizationId is required.");
  }

  if (!(await isOrgManager(organizationId, user.id))) {
    return apiError(403, "FORBIDDEN", "Only ADMIN or OWNER can manage expense categories.");
  }

  const parsed = createExpenseCategorySchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid request body.");
  }

  try {
    const category = await createExpenseCategory(organizationId, parsed.data, {
      actorUserId: user.id,
      correlationId: request.headers.get("x-correlation-id") ?? crypto.randomUUID(),
    });
    return NextResponse.json(category, { status: 201 });
  } catch (err) {
    if (err instanceof ExpenseCategoryValidationError) return apiError(400, "VALIDATION_ERROR", err.message);
    throw err;
  }
}
