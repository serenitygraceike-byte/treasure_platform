import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { canAccessCompany } from "@/lib/rbac";
import { apiError } from "@/lib/api-error";
import { getPayment } from "@/lib/payments/payments";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Sign in required.");

  const { id } = await params;
  const payment = await getPayment(id);
  if (!payment) return apiError(404, "NOT_FOUND", "Payment not found.");

  const company = await prisma.company.findUnique({ where: { id: payment.companyId } });
  if (!company || !(await canAccessCompany(company.id, company.organizationId, user.id))) {
    return apiError(404, "NOT_FOUND", "Payment not found.");
  }

  return NextResponse.json(payment);
}
