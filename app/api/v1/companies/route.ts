import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { getOrgMembership, isOrgManager } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { apiError } from "@/lib/api-error";
import { createCompanySchema } from "@/lib/validation/company";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Sign in required.");

  const organizationId = new URL(request.url).searchParams.get("organizationId");
  if (!organizationId) {
    return apiError(400, "MISSING_ORGANIZATION_ID", "organizationId query parameter is required.");
  }

  const membership = await getOrgMembership(organizationId, user.id);
  if (!membership) return apiError(404, "NOT_FOUND", "Organization not found.");

  // Org managers see every company in the org; other roles only see
  // companies they have an explicit CompanyMembership for.
  const isManager = ["OWNER", "ADMIN"].includes(membership.role);
  const companies = await prisma.company.findMany({
    where: isManager
      ? { organizationId }
      : { organizationId, companyMemberships: { some: { userId: user.id } } },
    orderBy: { legalName: "asc" },
  });

  return NextResponse.json(companies);
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Sign in required.");

  const body = await request.json().catch(() => null);
  const parsed = createCompanySchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid request body.");
  }

  const { organizationId, ...companyInput } = parsed.data;
  if (!(await isOrgManager(organizationId, user.id))) {
    return apiError(403, "FORBIDDEN", "Only OWNER or ADMIN can create companies.");
  }

  const existing = await prisma.company.findUnique({
    where: { organizationId_legalName: { organizationId, legalName: companyInput.legalName } },
  });
  if (existing) {
    return apiError(409, "COMPANY_EXISTS", "A company with this legal name already exists in the organization.");
  }

  const company = await prisma.company.create({
    data: { organizationId, ...companyInput },
  });

  await logAudit({
    organizationId,
    actorUserId: user.id,
    action: "company.create",
    objectType: "company",
    objectId: company.id,
    correlationId: request.headers.get("x-correlation-id") ?? undefined,
  });

  return NextResponse.json(company, { status: 201 });
}
