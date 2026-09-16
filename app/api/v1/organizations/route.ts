import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/api-error";

// Only organizations the caller has a membership in — never a global list.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Sign in required.");

  const memberships = await prisma.membership.findMany({
    where: { userId: user.id },
    include: { organization: true },
    orderBy: { organization: { name: "asc" } },
  });

  return NextResponse.json(
    memberships.map((m) => ({ ...m.organization, role: m.role }))
  );
}
