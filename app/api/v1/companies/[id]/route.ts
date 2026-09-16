import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { canAccessCompany, isOrgManager } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { apiError } from "@/lib/api-error";
import { updateCompanySchema } from "@/lib/validation/company";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Sign in required.");

  const { id } = await params;
  const company = await prisma.company.findUnique({ where: { id } });
  if (!company) return apiError(404, "NOT_FOUND", "Company not found.");

  if (!(await canAccessCompany(company.id, company.organizationId, user.id))) {
    return apiError(404, "NOT_FOUND", "Company not found.");
  }

  return NextResponse.json(company);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Sign in required.");

  const { id } = await params;
  const company = await prisma.company.findUnique({ where: { id } });
  if (!company) return apiError(404, "NOT_FOUND", "Company not found.");

  if (!(await isOrgManager(company.organizationId, user.id))) {
    return apiError(403, "FORBIDDEN", "Only OWNER or ADMIN can edit a company.");
  }

  const body = await request.json().catch(() => null);
  const parsed = updateCompanySchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid request body.");
  }
  if (Object.keys(parsed.data).length === 0) {
    return apiError(400, "VALIDATION_ERROR", "No fields to update.");
  }

  const updated = await prisma.company.update({
    where: { id },
    data: parsed.data,
  });

  await logAudit({
    organizationId: company.organizationId,
    actorUserId: user.id,
    action: "company.update",
    objectType: "company",
    objectId: company.id,
    correlationId: request.headers.get("x-correlation-id") ?? undefined,
    metadata: { fields: Object.keys(parsed.data) },
  });

  return NextResponse.json(updated);
}
