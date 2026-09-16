import { NextResponse } from "next/server";

// Liveness probe: the process is up and serving requests. Deliberately
// does not touch the database — that's what /api/ready is for.
export async function GET() {
  return NextResponse.json({ status: "ok" });
}
