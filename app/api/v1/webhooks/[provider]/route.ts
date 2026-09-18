import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { WebhookSignatureError } from "@/lib/providers/types";
import { receiveProviderWebhook, WebhookNotFoundError } from "@/lib/providers/webhook";

// docs/03-API-SPEC.md "Webhooks". :provider is a Provider row's id (not
// a type slug) -- see lib/providers/webhook.ts's header comment for why:
// each org gets its own auto-provisioned Provider row per type, so the
// row id is what a real callback URL would encode, not a bare type name
// that would be ambiguous across organizations.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider: providerId } = await params;

  try {
    const result = await receiveProviderWebhook(providerId, request);
    return NextResponse.json({ ok: true, duplicate: result.duplicate });
  } catch (err) {
    if (err instanceof WebhookNotFoundError) return apiError(404, "NOT_FOUND", "Unknown provider.");
    if (err instanceof WebhookSignatureError) return apiError(401, "INVALID_SIGNATURE", err.message);
    throw err;
  }
}
