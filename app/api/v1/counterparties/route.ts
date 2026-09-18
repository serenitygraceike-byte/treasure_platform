import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { isOrgManager } from "@/lib/rbac";
import { apiError } from "@/lib/api-error";
import { createCounterpartySchema } from "@/lib/validation/counterparty";
import { createCounterparty, listCounterparties } from "@/lib/counterparties";

// docs/03-API-SPEC.md "Counterparties" (Phase 6 -- not in the original
// spec). Org-scoped, same pattern as expense-categories.
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

  const counterparties = await listCounterparties(organizationId);
  return NextResponse.json(counterparties);
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
    return apiError(403, "FORBIDDEN", "Only ADMIN or OWNER can manage counterparties.");
  }

  const parsed = createCounterpartySchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid request body.");
  }

  const counterparty = await createCounterparty(organizationId, parsed.data, {
    actorUserId: user.id,
    correlationId: request.headers.get("x-correlation-id") ?? crypto.randomUUID(),
  });
  return NextResponse.json(counterparty, { status: 201 });
}
