import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { canManageTreasury } from "@/lib/rbac";
import { apiError } from "@/lib/api-error";
import {
  IntercompanyValidationError,
  reconcileIntercompanyTransfer,
} from "@/lib/treasury/intercompany";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Sign in required.");

  const { id } = await params;
  const transfer = await prisma.intercompanyTransfer.findUnique({ where: { id } });
  if (!transfer) return apiError(404, "NOT_FOUND", "Intercompany transfer not found.");

  const toCompany = await prisma.company.findUnique({ where: { id: transfer.toCompanyId } });
  if (!toCompany) return apiError(404, "NOT_FOUND", "Intercompany transfer not found.");

  if (!(await canManageTreasury(toCompany.id, toCompany.organizationId, user.id))) {
    return apiError(403, "FORBIDDEN", "Only TREASURY_MANAGER, ADMIN or OWNER of the receiving company can reconcile.");
  }

  try {
    const updated = await reconcileIntercompanyTransfer(id, {
      actorUserId: user.id,
      correlationId: request.headers.get("x-correlation-id") ?? crypto.randomUUID(),
    });
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof IntercompanyValidationError) return apiError(400, "VALIDATION_ERROR", err.message);
    throw err;
  }
}
