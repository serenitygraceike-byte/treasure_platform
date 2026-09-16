import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { canApproveIntercompany } from "@/lib/rbac";
import { apiError } from "@/lib/api-error";
import { rejectIntercompanyTransferSchema } from "@/lib/validation/intercompany";
import { rejectIntercompanyTransfer } from "@/lib/treasury/intercompany";

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
    return apiError(403, "FORBIDDEN", "Only an org-level APPROVER, ADMIN or OWNER can reject an intercompany transfer.");
  }

  const body = await request.json().catch(() => ({}));
  const parsed = rejectIntercompanyTransferSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return apiError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid request body.");
  }

  const updated = await rejectIntercompanyTransfer(
    id,
    { actorUserId: user.id, correlationId: request.headers.get("x-correlation-id") ?? crypto.randomUUID() },
    parsed.data.reason
  );
  return NextResponse.json(updated);
}
