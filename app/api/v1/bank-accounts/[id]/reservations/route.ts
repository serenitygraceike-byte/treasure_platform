import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { canManageTreasury } from "@/lib/rbac";
import { apiError } from "@/lib/api-error";
import { LedgerError } from "@/lib/ledger/errors";
import { createReservationSchema } from "@/lib/validation/treasury";
import { createReservation } from "@/lib/treasury/reservations";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Sign in required.");

  const { id: bankAccountId } = await params;
  const bankAccount = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
  if (!bankAccount) return apiError(404, "NOT_FOUND", "Bank account not found.");

  const company = await prisma.company.findUnique({ where: { id: bankAccount.companyId } });
  if (!company) return apiError(404, "NOT_FOUND", "Bank account not found.");

  if (!(await canManageTreasury(company.id, company.organizationId, user.id))) {
    return apiError(403, "FORBIDDEN", "Only TREASURY_MANAGER, ADMIN or OWNER can reserve funds.");
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) {
    return apiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required.");
  }

  const body = await request.json().catch(() => null);
  const parsed = createReservationSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid request body.");
  }

  try {
    const reservation = await createReservation(bankAccount, {
      amount: parsed.data.amount,
      idempotencyKey,
      actorUserId: user.id,
      correlationId: request.headers.get("x-correlation-id") ?? crypto.randomUUID(),
    });
    return NextResponse.json(reservation, { status: 201 });
  } catch (err) {
    if (err instanceof LedgerError) return apiError(502, err.code, err.message);
    throw err;
  }
}
