import { NextResponse } from "next/server";
import crypto from "node:crypto";

// Shared shape per docs/03-API-SPEC.md — never include provider secrets or
// raw dependency errors in the message.
export function apiError(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message, requestId: crypto.randomUUID() } },
    { status }
  );
}
