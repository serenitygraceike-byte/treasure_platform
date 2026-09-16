import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { canManageTreasury } from "@/lib/rbac";
import { apiError } from "@/lib/api-error";
import { LedgerError } from "@/lib/ledger/errors";
import { releaseReservation } from "@/lib/treasury/reservations";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Sign in required.");

  const { id } = await params;
  const reservation = await prisma.bankReservation.findUnique({ where: { id } });
  if (!reservation) return apiError(404, "NOT_FOUND", "Reservation not found.");

  const company = await prisma.company.findUnique({ where: { id: reservation.companyId } });
  if (!company) return apiError(404, "NOT_FOUND", "Reservation not found.");

  if (!(await canManageTreasury(company.id, company.organizationId, user.id))) {
    return apiError(403, "FORBIDDEN", "Only TREASURY_MANAGER, ADMIN or OWNER can release a reservation.");
  }

  try {
    const updated = await releaseReservation(id, {
      actorUserId: user.id,
      correlationId: request.headers.get("x-correlation-id") ?? crypto.randomUUID(),
    });
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof LedgerError) return apiError(502, err.code, err.message);
    throw err;
  }
}
