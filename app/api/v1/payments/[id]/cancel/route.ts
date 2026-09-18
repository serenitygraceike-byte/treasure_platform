import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { canManageTreasury } from "@/lib/rbac";
import { apiError } from "@/lib/api-error";
import { cancelPayment, getPayment, PaymentValidationError } from "@/lib/payments/payments";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Sign in required.");

  const { id } = await params;
  const payment = await getPayment(id);
  if (!payment) return apiError(404, "NOT_FOUND", "Payment not found.");

  const company = await prisma.company.findUnique({ where: { id: payment.companyId } });
  if (!company) return apiError(404, "NOT_FOUND", "Payment not found.");

  if (!(await canManageTreasury(company.id, company.organizationId, user.id))) {
    return apiError(403, "FORBIDDEN", "Only TREASURY_MANAGER, ADMIN or OWNER can cancel a payment.");
  }

  try {
    const updated = await cancelPayment(id, {
      actorUserId: user.id,
      correlationId: request.headers.get("x-correlation-id") ?? crypto.randomUUID(),
    });
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof PaymentValidationError) return apiError(400, "VALIDATION_ERROR", err.message);
    throw err;
  }
}
