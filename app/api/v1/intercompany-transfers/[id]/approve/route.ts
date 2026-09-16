import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { canApproveIntercompany } from "@/lib/rbac";
import { apiError } from "@/lib/api-error";
import { LedgerError } from "@/lib/ledger/errors";
import { approveIntercompanyTransfer } from "@/lib/treasury/intercompany";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Sign in required.");

  const { id } = await params;
  const transfer = await prisma.intercompanyTransfer.findUnique({ where: { id } });
  if (!transfer) return apiError(404, "NOT_FOUND", "Intercompany transfer not found.");

  if (!(await canApproveIntercompany(transfer.organizationId, user.id))) {
    return apiError(403, "FORBIDDEN", "Only an org-level APPROVER, ADMIN or OWNER can approve an intercompany transfer.");
  }

  try {
    const updated = await approveIntercompanyTransfer(id, {
      actorUserId: user.id,
      correlationId: request.headers.get("x-correlation-id") ?? crypto.randomUUID(),
    });
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof LedgerError) return apiError(502, err.code, err.message);
    throw err;
  }
}
