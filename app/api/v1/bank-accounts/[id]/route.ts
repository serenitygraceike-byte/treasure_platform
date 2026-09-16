import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { canManageTreasury } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { apiError } from "@/lib/api-error";
import { updateBankAccountSchema } from "@/lib/validation/bank-account";
import { getBankAccount, updateBankAccount } from "@/lib/treasury/bank-accounts";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Sign in required.");

  const { id } = await params;
  const bankAccount = await getBankAccount(id);
  if (!bankAccount) return apiError(404, "NOT_FOUND", "Bank account not found.");

  const company = await prisma.company.findUnique({ where: { id: bankAccount.companyId } });
  if (!company) return apiError(404, "NOT_FOUND", "Bank account not found.");

  if (!(await canManageTreasury(company.id, company.organizationId, user.id))) {
    return apiError(403, "FORBIDDEN", "Only TREASURY_MANAGER, ADMIN or OWNER can edit a bank account.");
  }

  const body = await request.json().catch(() => null);
  const parsed = updateBankAccountSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid request body.");
  }
  if (Object.keys(parsed.data).length === 0) {
    return apiError(400, "VALIDATION_ERROR", "No fields to update.");
  }

  const updated = await updateBankAccount(id, parsed.data);

  await logAudit({
    organizationId: company.organizationId,
    actorUserId: user.id,
    action: "bank_account.update",
    objectType: "bank_account",
    objectId: bankAccount.id,
    correlationId: request.headers.get("x-correlation-id") ?? undefined,
    metadata: { fields: Object.keys(parsed.data) },
  });

  return NextResponse.json(updated);
}
