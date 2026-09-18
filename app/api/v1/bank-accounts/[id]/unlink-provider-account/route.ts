import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { canManageTreasury } from "@/lib/rbac";
import { apiError } from "@/lib/api-error";
import { unlinkBankAccount } from "@/lib/providers/piraeus/service";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Sign in required.");

  const { id: bankAccountId } = await params;
  const bankAccount = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
  if (!bankAccount) return apiError(404, "NOT_FOUND", "Bank account not found.");

  const company = await prisma.company.findUniqueOrThrow({ where: { id: bankAccount.companyId } });
  if (!(await canManageTreasury(company.id, company.organizationId, user.id))) {
    return apiError(403, "FORBIDDEN", "Only TREASURY_MANAGER, ADMIN or OWNER can unlink a provider account.");
  }

  const link = await prisma.providerAccountLink.findFirst({ where: { bankAccountId, status: "ACTIVE" } });
  if (!link) return apiError(404, "NOT_FOUND", "This bank account has no active provider link.");

  const updated = await unlinkBankAccount(link.id, user.id);
  return NextResponse.json(updated);
}
