import { prisma } from "@/lib/prisma";
import { verifyProviderWebhook } from "./registry";
import { payloadHash } from "./mock-shared";
import { WebhookSignatureError } from "./types";
import { handlePaymentFailed, handlePaymentSettled } from "@/lib/payments/payments";

export class WebhookNotFoundError extends Error {}

// docs/05-MVP-ROADMAP.md Phase 6 "webhook framework". CLAUDE.md rule 8:
// every webhook must be verified and deduplicated. Dedup key is
// (providerId, externalEventId): a row already PROCESSED is a true
// duplicate (ignored, no reprocessing -- "duplicate webhook" from
// docs/06-PROVIDER-INTERFACES.md); a row stuck at RECEIVED/ERROR (e.g.
// the process crashed mid-handling) is retried in place ("retry" from
// the same doc), same event, same row.
export async function receiveProviderWebhook(providerId: string, request: Request) {
  const provider = await prisma.provider.findUnique({ where: { id: providerId } });
  if (!provider) throw new WebhookNotFoundError("Unknown provider.");

  // .clone() so verifyProviderWebhook can still read the body itself --
  // Request bodies can only be consumed once, and the hash below must be
  // taken even when the signature turns out to be invalid.
  const rawBody = await request.clone().text();
  const hash = payloadHash(rawBody);

  let event;
  try {
    event = await verifyProviderWebhook(provider.type, request);
  } catch (err) {
    if (err instanceof WebhookSignatureError) {
      // Best-effort log; a P2002 here just means the exact same invalid
      // payload was already recorded, which is fine to swallow.
      await prisma.webhook
        .create({
          data: {
            providerId,
            externalEventId: `invalid:${hash}`,
            eventType: "unknown",
            signatureValid: false,
            payloadHash: hash,
            status: "ERROR",
            errorMessage: err.message,
          },
        })
        .catch(() => {});
    }
    throw err;
  }

  const existing = await prisma.webhook.findUnique({
    where: { providerId_externalEventId: { providerId, externalEventId: event.externalEventId } },
  });
  if (existing?.status === "PROCESSED") {
    return { duplicate: true, webhook: existing };
  }

  const webhook = existing
    ? await prisma.webhook.update({
        where: { id: existing.id },
        data: { signatureValid: true, payloadHash: hash, eventType: event.eventType },
      })
    : await prisma.webhook.create({
        data: {
          providerId,
          externalEventId: event.externalEventId,
          eventType: event.eventType,
          signatureValid: true,
          payloadHash: hash,
        },
      });

  try {
    if (event.status === "SUCCEEDED") {
      await handlePaymentSettled(event, { correlationId: webhook.id });
    } else if (event.status === "FAILED") {
      await handlePaymentFailed(event, { correlationId: webhook.id });
    }
    // A PENDING event has nothing to apply -- webhooks report terminal
    // outcomes; ignore and mark processed.
    await prisma.webhook.update({ where: { id: webhook.id }, data: { status: "PROCESSED", processedAt: new Date() } });
  } catch (err) {
    await prisma.webhook.update({
      where: { id: webhook.id },
      data: { status: "ERROR", errorMessage: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }

  return { duplicate: false, webhook };
}
