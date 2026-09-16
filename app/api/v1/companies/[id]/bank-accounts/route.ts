import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { canAccessCompany, canManageTreasury } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { apiError } from "@/lib/api-error";
import { createBankAccountSchema } from "@/lib/validation/bank-account";
import { createBankAccount, listBankAccounts } from "@/lib/treasury/bank-accounts";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Sign in required.");

  const { id: companyId } = await params;
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) return apiError(404, "NOT_FOUND", "Company not found.");

  if (!(await canAccessCompany(company.id, company.organizationId, user.id))) {
    return apiError(404, "NOT_FOUND", "Company not found.");
  }

  const bankAccounts = await listBankAccounts(companyId);
  return NextResponse.json(bankAccounts);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Sign in required.");

  const { id: companyId } = await params;
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) return apiError(404, "NOT_FOUND", "Company not found.");

  if (!(await canAccessCompany(company.id, company.organizationId, user.id))) {
    return apiError(404, "NOT_FOUND", "Company not found.");
  }
  if (!(await canManageTreasury(company.id, company.organizationId, user.id))) {
    return apiError(403, "FORBIDDEN", "Only TREASURY_MANAGER, ADMIN or OWNER can add bank accounts.");
  }

  const body = await request.json().catch(() => null);
  const parsed = createBankAccountSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid request body.");
  }

  const bankAccount = await createBankAccount({
    organizationId: company.organizationId,
    companyId: company.id,
    ...parsed.data,
  });

  await logAudit({
    organizationId: company.organizationId,
    actorUserId: user.id,
    action: "bank_account.create",
    objectType: "bank_account",
    objectId: bankAccount.id,
    correlationId: request.headers.get("x-correlation-id") ?? undefined,
  });

  return NextResponse.json(bankAccount, { status: 201 });
}
