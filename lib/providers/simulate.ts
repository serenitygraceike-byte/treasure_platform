import crypto from "node:crypto";
import { buildMockWebhookRequest } from "./mock-shared";
import { receiveProviderWebhook } from "./webhook";
import type { ProviderOutcome } from "./types";

// Mock providers have no real async delivery mechanism, so a PENDING
// payment's eventual webhook has to be triggered on purpose -- this is
// that trigger, used by the dashboard's "Simulate webhook" button and by
// tests. It builds the exact Request a real provider callback would
// send (signed the same way, same lib/providers/webhook.ts code path),
// not a shortcut that skips verification/dedup.
export async function simulateProviderWebhook(
  providerId: string,
  providerPaymentId: string,
  outcome: Exclude<ProviderOutcome, "PENDING">,
  failure?: { failureCode: string; failureReason: string }
) {
  const request = buildMockWebhookRequest(`http://internal/api/v1/webhooks/${providerId}`, {
    externalEventId: crypto.randomUUID(),
    eventType: outcome === "SUCCEEDED" ? "payment.succeeded" : "payment.failed",
    providerPaymentId,
    status: outcome,
    ...(failure ?? {}),
  });
  return receiveProviderWebhook(providerId, request);
}
