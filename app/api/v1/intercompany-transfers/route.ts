import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { canAccessCompany, canManageTreasury } from "@/lib/rbac";
import { apiError } from "@/lib/api-error";
import { LedgerError } from "@/lib/ledger/errors";
import { createIntercompanyTransferSchema } from "@/lib/validation/intercompany";
import {
  createIntercompanyTransfer,
  IntercompanyValidationError,
  listIntercompanyTransfers,
} from "@/lib/treasury/intercompany";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Sign in required.");

  const companyId = new URL(request.url).searchParams.get("companyId");
  if (!companyId) {
    return apiError(400, "MISSING_COMPANY_ID", "companyId query parameter is required.");
  }

  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) return apiError(404, "NOT_FOUND", "Company not found.");

  if (!(await canAccessCompany(company.id, company.organizationId, user.id))) {
    return apiError(404, "NOT_FOUND", "Company not found.");
  }

  const transfers = await listIntercompanyTransfers(companyId);
  return NextResponse.json(transfers);
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Sign in required.");

  const body = await request.json().catch(() => null);
  const parsed = createIntercompanyTransferSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid request body.");
  }

  const bankAccount = await prisma.bankAccount.findUnique({
    where: { id: parsed.data.bankAccountId },
  });
  if (!bankAccount) return apiError(404, "NOT_FOUND", "Bank account not found.");

  const company = await prisma.company.findUnique({ where: { id: bankAccount.companyId } });
  if (!company) return apiError(404, "NOT_FOUND", "Bank account not found.");

  if (!(await canManageTreasury(company.id, company.organizationId, user.id))) {
    return apiError(403, "FORBIDDEN", "Only TREASURY_MANAGER, ADMIN or OWNER can request an intercompany transfer.");
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) {
    return apiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required.");
  }

  try {
    const transfer = await createIntercompanyTransfer(bankAccount, {
      toCompanyId: parsed.data.toCompanyId,
      destinationAccountId: parsed.data.destinationAccountId,
      amount: parsed.data.amount,
      purpose: parsed.data.purpose,
      dueAt: parsed.data.dueAt,
      idempotencyKey,
      actorUserId: user.id,
      correlationId: request.headers.get("x-correlation-id") ?? crypto.randomUUID(),
    });
    return NextResponse.json(transfer, { status: 201 });
  } catch (err) {
    if (err instanceof IntercompanyValidationError) return apiError(400, "VALIDATION_ERROR", err.message);
    if (err instanceof LedgerError) return apiError(502, err.code, err.message);
    throw err;
  }
}
