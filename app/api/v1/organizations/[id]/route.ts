import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { getOrgMembership } from "@/lib/rbac";
import { apiError } from "@/lib/api-error";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Sign in required.");

  const { id } = await params;
  const membership = await getOrgMembership(id, user.id);
  // 404, not 403, for an org the caller isn't a member of — don't confirm
  // whether the organization exists to someone with no access to it.
  if (!membership) return apiError(404, "NOT_FOUND", "Organization not found.");

  const organization = await prisma.organization.findUnique({ where: { id } });
  if (!organization) return apiError(404, "NOT_FOUND", "Organization not found.");

  return NextResponse.json({ ...organization, role: membership.role });
}
