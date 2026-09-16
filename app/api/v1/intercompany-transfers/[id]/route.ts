import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { canAccessCompany } from "@/lib/rbac";
import { apiError } from "@/lib/api-error";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Sign in required.");

  const { id } = await params;
  const transfer = await prisma.intercompanyTransfer.findUnique({ where: { id } });
  if (!transfer) return apiError(404, "NOT_FOUND", "Intercompany transfer not found.");

  const hasAccess =
    (await canAccessCompany(transfer.fromCompanyId, transfer.organizationId, user.id)) ||
    (await canAccessCompany(transfer.toCompanyId, transfer.organizationId, user.id));
  if (!hasAccess) return apiError(404, "NOT_FOUND", "Intercompany transfer not found.");

  return NextResponse.json(transfer);
}
