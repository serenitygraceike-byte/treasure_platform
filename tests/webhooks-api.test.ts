import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/providers/webhook", () => ({
  receiveProviderWebhook: vi.fn(),
  WebhookNotFoundError: class WebhookNotFoundError extends Error {},
}));

import { receiveProviderWebhook, WebhookNotFoundError } from "@/lib/providers/webhook";
import { WebhookSignatureError } from "@/lib/providers/types";
import { POST as webhookRoute } from "@/app/api/v1/webhooks/[provider]/route";

function params(provider: string) {
  return { params: Promise.resolve({ provider }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/v1/webhooks/:provider", () => {
  it("returns 404 for an unknown provider", async () => {
    vi.mocked(receiveProviderWebhook).mockRejectedValueOnce(new WebhookNotFoundError("nope"));

    const res = await webhookRoute(new Request("http://localhost/x", { method: "POST", body: "{}" }), params("prov1"));

    expect(res.status).toBe(404);
  });

  it("returns 401 for an invalid signature", async () => {
    vi.mocked(receiveProviderWebhook).mockRejectedValueOnce(new WebhookSignatureError("bad sig"));

    const res = await webhookRoute(new Request("http://localhost/x", { method: "POST", body: "{}" }), params("prov1"));

    expect(res.status).toBe(401);
  });

  it("returns 200 and reports duplicate status", async () => {
    vi.mocked(receiveProviderWebhook).mockResolvedValueOnce({ duplicate: true, webhook: { id: "w1" } } as never);

    const res = await webhookRoute(new Request("http://localhost/x", { method: "POST", body: "{}" }), params("prov1"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, duplicate: true });
  });
});
