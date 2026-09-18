import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { canManageTreasury } from "@/lib/rbac";
import { apiError } from "@/lib/api-error";
import { listExternalAccounts } from "@/lib/providers/piraeus/service";

// Provider-neutral path (docs/13-PIRAEUS-PROVIDER.md "API"): the query
// param names a connection, not a provider -- a future Alpha Bank/NBG
// adapter reuses this exact route.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Sign in required.");

  const { id: bankAccountId } = await params;
  const bankAccount = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
  if (!bankAccount) return apiError(404, "NOT_FOUND", "Bank account not found.");

  const company = await prisma.company.findUniqueOrThrow({ where: { id: bankAccount.companyId } });
  if (!(await canManageTreasury(company.id, company.organizationId, user.id))) {
    return apiError(403, "FORBIDDEN", "Only TREASURY_MANAGER, ADMIN or OWNER can view provider accounts.");
  }

  const connectionId = new URL(request.url).searchParams.get("connectionId");
  if (!connectionId) return apiError(400, "MISSING_CONNECTION_ID", "connectionId query parameter is required.");

  const connection = await prisma.providerConnection.findUnique({ where: { id: connectionId } });
  if (!connection || connection.organizationId !== company.organizationId) {
    return apiError(404, "NOT_FOUND", "Provider connection not found.");
  }

  const accounts = await listExternalAccounts(connectionId);
  return NextResponse.json(accounts);
}
