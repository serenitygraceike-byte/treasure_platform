import crypto from "node:crypto";
import type { ProviderEvent, ProviderOutcome } from "./types";
import { WebhookSignatureError } from "./types";

// docs/06-PROVIDER-INTERFACES.md: mock providers "must simulate: success,
// pending, failure, duplicate webhook, retry". Success/pending/failure
// are controlled deterministically by the last two decimal digits of the
// amount, so tests and demos can pick an outcome on purpose instead of
// relying on randomness -- ".13" fails, ".66" is pending (needs a
// webhook to resolve), everything else succeeds immediately. Duplicate
// webhook and retry are exercised at the webhook-dedup layer
// (lib/providers/webhook.ts) and the payment execute-retry layer
// (lib/payments/payments.ts), not here.
export function mockOutcomeForAmount(amount: string): ProviderOutcome {
  const cents = amount.split(".")[1]?.padEnd(2, "0").slice(0, 2);
  if (cents === "13") return "FAILED";
  if (cents === "66") return "PENDING";
  return "SUCCEEDED";
}

function webhookSecret(): string {
  const secret = process.env.MOCK_PROVIDER_WEBHOOK_SECRET;
  if (!secret) throw new Error("MOCK_PROVIDER_WEBHOOK_SECRET must be set.");
  return secret;
}

function sign(body: string): string {
  return crypto.createHmac("sha256", webhookSecret()).update(body).digest("hex");
}

// Builds the Request a real provider's webhook delivery would send --
// used by lib/providers/simulate.ts to exercise the exact same
// lib/providers/webhook.ts code path a live callback would hit.
export function buildMockWebhookRequest(url: string, event: ProviderEvent): Request {
  const body = JSON.stringify(event);
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-mock-signature": sign(body) },
    body,
  });
}

export async function verifyMockWebhook(request: Request): Promise<ProviderEvent> {
  const body = await request.text();
  const signature = request.headers.get("x-mock-signature") ?? "";
  const expected = sign(body);
  const valid =
    signature.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!valid) {
    throw new WebhookSignatureError("Invalid mock provider webhook signature.");
  }
  return JSON.parse(body) as ProviderEvent;
}

export function payloadHash(body: string): string {
  return crypto.createHash("sha256").update(body).digest("hex");
}
