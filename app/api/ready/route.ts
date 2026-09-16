import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Readiness probe: can this instance actually serve traffic right now.
// Per docs/04-DEPLOYMENT-SPEC.md, checks application + PostgreSQL.
// A Ledger (Formance) connectivity check is added in Phase 2, once the
// ledger adapter exists — not invented here ahead of that integration.
// Dependency error details are logged server-side only, never returned to
// the caller (docs/04-DEPLOYMENT-SPEC.md: "Do not expose detailed
// dependency errors publicly").
export async function GET() {
  const checks: Record<string, "ok" | "error"> = { application: "ok" };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch (err) {
    checks.database = "error";
    console.error("[ready] database check failed", err);
  }

  const ready = Object.values(checks).every((v) => v === "ok");
  return NextResponse.json({ status: ready ? "ready" : "not_ready", checks }, { status: ready ? 200 : 503 });
}
