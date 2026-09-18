import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { canManageTreasury } from "@/lib/rbac";
import { apiError } from "@/lib/api-error";
import { linkProviderAccountSchema } from "@/lib/validation/piraeus";
import { PiraeusServiceError, linkBankAccount } from "@/lib/providers/piraeus/service";

// Explicit, one-account-at-a-time linking (docs/13-PIRAEUS-PROVIDER.md
// "Existing bank accounts") -- never auto-links everything a
// connection can see.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Sign in required.");

  const { id: bankAccountId } = await params;
  const bankAccount = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
  if (!bankAccount) return apiError(404, "NOT_FOUND", "Bank account not found.");

  const company = await prisma.company.findUniqueOrThrow({ where: { id: bankAccount.companyId } });
  if (!(await canManageTreasury(company.id, company.organizationId, user.id))) {
    return apiError(403, "FORBIDDEN", "Only TREASURY_MANAGER, ADMIN or OWNER can link a provider account.");
  }

  const body = await request.json().catch(() => null);
  const parsed = linkProviderAccountSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid request body.");
  }

  try {
    const link = await linkBankAccount({
      bankAccount,
      connectionId: parsed.data.connectionId,
      externalAccountId: parsed.data.externalAccountId,
      actorUserId: user.id,
    });
    return NextResponse.json(link, { status: 201 });
  } catch (err) {
    if (err instanceof PiraeusServiceError) return apiError(400, "VALIDATION_ERROR", err.message);
    throw err;
  }
}
