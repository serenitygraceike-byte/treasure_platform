import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { canAccessCompany } from "@/lib/rbac";
import { apiError } from "@/lib/api-error";
import { listTransfers } from "@/lib/treasury/transfers";

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

  const transfers = await listTransfers(companyId);
  return NextResponse.json(transfers);
}
