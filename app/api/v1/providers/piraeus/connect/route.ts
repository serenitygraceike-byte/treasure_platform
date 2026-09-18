import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { canManageProviderConnections } from "@/lib/rbac";
import { apiError } from "@/lib/api-error";
import { connectPiraeusSchema } from "@/lib/validation/piraeus";
import { initiateConnection } from "@/lib/providers/piraeus/service";

// docs/13-PIRAEUS-PROVIDER.md. Provider-specific OAuth endpoint (the
// task brief explicitly allows this, unlike bank data itself).
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Sign in required.");

  const body = await request.json().catch(() => null);
  const parsed = connectPiraeusSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid request body.");
  }

  const membership = await prisma.membership.findUnique({
    where: { organizationId_userId: { organizationId: parsed.data.organizationId, userId: user.id } },
  });
  if (!membership) return apiError(404, "NOT_FOUND", "Organization not found.");

  if (!(await canManageProviderConnections(parsed.data.organizationId, user.id))) {
    return apiError(403, "FORBIDDEN", "Only TREASURY_MANAGER, ADMIN or OWNER can connect a bank provider.");
  }

  const { authorizationUrl } = await initiateConnection({
    organizationId: parsed.data.organizationId,
    userId: user.id,
    companyId: parsed.data.companyId,
  });
  return NextResponse.json({ authorizationUrl });
}
