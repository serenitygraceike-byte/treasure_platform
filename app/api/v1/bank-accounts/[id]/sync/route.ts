import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { canManageTreasury } from "@/lib/rbac";
import { apiError } from "@/lib/api-error";
import { PiraeusServiceError, SyncCooldownError, syncLinkFully } from "@/lib/providers/piraeus/service";
import { PiraeusApiError } from "@/lib/providers/piraeus/errors";

// Manual synchronization -- rate-guarded by SyncState.nextAllowedSyncAt
// (docs/13-PIRAEUS-PROVIDER.md "Manual sync must have a cooldown/rate
// guard"). The background scripts/piraeus-sync-worker.ts covers regular
// polling; this is the "sync now" button.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Sign in required.");

  const { id: bankAccountId } = await params;
  const bankAccount = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
  if (!bankAccount) return apiError(404, "NOT_FOUND", "Bank account not found.");

  const company = await prisma.company.findUniqueOrThrow({ where: { id: bankAccount.companyId } });
  if (!(await canManageTreasury(company.id, company.organizationId, user.id))) {
    return apiError(403, "FORBIDDEN", "Only TREASURY_MANAGER, ADMIN or OWNER can trigger a sync.");
  }

  const link = await prisma.providerAccountLink.findFirst({ where: { bankAccountId, status: "ACTIVE" } });
  if (!link) return apiError(404, "NOT_FOUND", "This bank account has no active provider link.");

  try {
    const result = await syncLinkFully(link.id, { manual: true });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof SyncCooldownError) return apiError(429, "SYNC_COOLDOWN", err.message);
    if (err instanceof PiraeusServiceError) return apiError(400, "VALIDATION_ERROR", err.message);
    if (err instanceof PiraeusApiError) return apiError(502, err.code, err.message);
    throw err;
  }
}
