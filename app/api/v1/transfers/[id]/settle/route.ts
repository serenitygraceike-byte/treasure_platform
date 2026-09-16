import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { canManageTreasury } from "@/lib/rbac";
import { apiError } from "@/lib/api-error";
import { LedgerError } from "@/lib/ledger/errors";
import { settleTransfer } from "@/lib/treasury/transfers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Sign in required.");

  const { id } = await params;
  const transfer = await prisma.bankTransfer.findUnique({ where: { id } });
  if (!transfer) return apiError(404, "NOT_FOUND", "Transfer not found.");

  const company = await prisma.company.findUnique({ where: { id: transfer.companyId } });
  if (!company) return apiError(404, "NOT_FOUND", "Transfer not found.");

  if (!(await canManageTreasury(company.id, company.organizationId, user.id))) {
    return apiError(403, "FORBIDDEN", "Only TREASURY_MANAGER, ADMIN or OWNER can settle a transfer.");
  }

  try {
    const updated = await settleTransfer(id, {
      actorUserId: user.id,
      correlationId: request.headers.get("x-correlation-id") ?? crypto.randomUUID(),
    });
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof LedgerError) return apiError(502, err.code, err.message);
    throw err;
  }
}
