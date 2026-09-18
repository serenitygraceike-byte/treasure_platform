import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { isOrgManager } from "@/lib/rbac";
import { apiError } from "@/lib/api-error";
import { createBeneficiarySchema } from "@/lib/validation/counterparty";
import { createBeneficiary, listBeneficiaries } from "@/lib/counterparties";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Sign in required.");

  const { id: counterpartyId } = await params;
  const counterparty = await prisma.counterparty.findUnique({ where: { id: counterpartyId } });
  if (!counterparty) return apiError(404, "NOT_FOUND", "Counterparty not found.");

  const membership = await prisma.membership.findUnique({
    where: { organizationId_userId: { organizationId: counterparty.organizationId, userId: user.id } },
  });
  if (!membership) return apiError(404, "NOT_FOUND", "Counterparty not found.");

  const beneficiaries = await listBeneficiaries(counterpartyId);
  return NextResponse.json(beneficiaries);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Sign in required.");

  const { id: counterpartyId } = await params;
  const counterparty = await prisma.counterparty.findUnique({ where: { id: counterpartyId } });
  if (!counterparty) return apiError(404, "NOT_FOUND", "Counterparty not found.");

  if (!(await isOrgManager(counterparty.organizationId, user.id))) {
    return apiError(403, "FORBIDDEN", "Only ADMIN or OWNER can manage beneficiaries.");
  }

  const body = await request.json().catch(() => null);
  const parsed = createBeneficiarySchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid request body.");
  }

  const beneficiary = await createBeneficiary(counterparty, parsed.data, {
    actorUserId: user.id,
    correlationId: request.headers.get("x-correlation-id") ?? crypto.randomUUID(),
  });
  return NextResponse.json(beneficiary, { status: 201 });
}
