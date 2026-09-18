import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { canAccessCompany } from "@/lib/rbac";
import { apiError } from "@/lib/api-error";
import { compareLatestBalanceToLedger } from "@/lib/providers/piraeus/service";

// docs/13-PIRAEUS-PROVIDER.md "Balance invariant": returns the latest
// persisted observation plus a read-only comparison to the Formance
// ledger balance -- never writes anything. `null` means no observation
// has been recorded yet (nothing has been synced).
export async function GET(
  _request: Request,
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

  const comparison = await compareLatestBalanceToLedger(bankAccount);
  return NextResponse.json(comparison);
}
