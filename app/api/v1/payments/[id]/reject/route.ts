import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { canApprovePayment } from "@/lib/rbac";
import { apiError } from "@/lib/api-error";
import { rejectPaymentSchema } from "@/lib/validation/payment";
import { getPayment, rejectPayment } from "@/lib/payments/payments";

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

  if (!(await canApprovePayment(company.id, company.organizationId, user.id))) {
    return apiError(403, "FORBIDDEN", "Only an APPROVER, ADMIN or OWNER can reject a payment.");
  }

  const body = await request.json().catch(() => ({}));
  const parsed = rejectPaymentSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid request body.");
  }

  const updated = await rejectPayment(
    id,
    { actorUserId: user.id, correlationId: request.headers.get("x-correlation-id") ?? crypto.randomUUID() },
    parsed.data.reason
  );
  return NextResponse.json(updated);
}
