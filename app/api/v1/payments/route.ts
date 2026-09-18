import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { canAccessCompany, canRequestPayment } from "@/lib/rbac";
import { apiError } from "@/lib/api-error";
import { createPaymentSchema } from "@/lib/validation/payment";
import { createPayment, listPayments, PaymentValidationError } from "@/lib/payments/payments";

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

  const payments = await listPayments(companyId);
  return NextResponse.json(payments);
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Sign in required.");

  const body = await request.json().catch(() => null);
  const parsed = createPaymentSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid request body.");
  }

  const company = await prisma.company.findUnique({ where: { id: parsed.data.companyId } });
  if (!company) return apiError(404, "NOT_FOUND", "Company not found.");

  if (!(await canRequestPayment(company.id, company.organizationId, user.id))) {
    return apiError(403, "FORBIDDEN", "Only TREASURY_MANAGER, ADMIN or OWNER can request a payment.");
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) {
    return apiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required.");
  }

  const bankAccount = await prisma.bankAccount.findUnique({ where: { id: parsed.data.bankAccountId } });
  if (!bankAccount) return apiError(404, "NOT_FOUND", "Bank account not found.");

  const beneficiary = await prisma.beneficiary.findUnique({
    where: { id: parsed.data.beneficiaryId },
    include: { counterparty: true },
  });
  if (!beneficiary) return apiError(404, "NOT_FOUND", "Beneficiary not found.");

  try {
    const payment = await createPayment(company, bankAccount, beneficiary, {
      paymentType: parsed.data.paymentType,
      paymentMethod: parsed.data.paymentMethod,
      amount: parsed.data.amount,
      currency: parsed.data.currency,
      idempotencyKey,
      actorUserId: user.id,
      correlationId: request.headers.get("x-correlation-id") ?? crypto.randomUUID(),
    });
    return NextResponse.json(payment, { status: 201 });
  } catch (err) {
    if (err instanceof PaymentValidationError) return apiError(400, "VALIDATION_ERROR", err.message);
    throw err;
  }
}
