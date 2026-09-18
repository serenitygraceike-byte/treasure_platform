import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { canAccessCompany } from "@/lib/rbac";
import { apiError } from "@/lib/api-error";

// Read-only list of already-synced ExternalTransaction rows -- this
// route never calls Piraeus itself (that's POST .../sync); it just
// reads what a previous sync persisted. Reconciliation-ready, not
// auto-posted to Formance (docs/13-PIRAEUS-PROVIDER.md).
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Sign in required.");

  const { id: bankAccountId } = await params;
  const bankAccount = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
  if (!bankAccount) return apiError(404, "NOT_FOUND", "Bank account not found.");

  const company = await prisma.company.findUniqueOrThrow({ where: { id: bankAccount.companyId } });
  if (!(await canAccessCompany(company.id, company.organizationId, user.id))) {
    return apiError(404, "NOT_FOUND", "Bank account not found.");
  }

  const limitParam = Number(new URL(request.url).searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 200) : 50;

  const transactions = await prisma.externalTransaction.findMany({
    where: { bankAccountId },
    orderBy: { bookingDate: "desc" },
    take: limit,
  });
  return NextResponse.json(transactions);
}
