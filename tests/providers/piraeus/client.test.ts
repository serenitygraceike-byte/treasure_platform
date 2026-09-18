import { describe, expect, it, vi, beforeEach, beforeAll } from "vitest";
import { piraeusRequest } from "@/lib/providers/piraeus/client";
import { PiraeusApiError, PiraeusAuthError, PiraeusRateLimitError } from "@/lib/providers/piraeus/errors";

beforeAll(() => {
  process.env.PIRAEUS_BASE_URL = "https://api.rapidlink.example/piraeusbank/sandbox";
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

describe("piraeusRequest", () => {
  it("returns the parsed JSON body on 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse(200, { ok: true })));
    const result = await piraeusRequest<{ ok: boolean }>({ accessToken: "t", path: "/v1/accounts" });
    expect(result).toEqual({ ok: true });
  });

  it("sends the access token as a Bearer Authorization header", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    await piraeusRequest({ accessToken: "secret-token", path: "/v1/accounts" });
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-token");
  });

  it("maps a 401 to PiraeusAuthError without retrying", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(401, { message: "invalid token" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(piraeusRequest({ accessToken: "t", path: "/v1/accounts" })).rejects.toBeInstanceOf(PiraeusAuthError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 honoring Retry-After, then throws PiraeusRateLimitError if still limited", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, {}, { "retry-after": "0.01" }))
      .mockResolvedValueOnce(jsonResponse(429, {}, { "retry-after": "0.01" }))
      .mockResolvedValueOnce(jsonResponse(429, {}, { "retry-after": "0.01" }))
      .mockResolvedValueOnce(jsonResponse(429, {}, { "retry-after": "0.01" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(piraeusRequest({ accessToken: "t", path: "/v1/accounts" })).rejects.toBeInstanceOf(PiraeusRateLimitError);
    expect(fetchMock).toHaveBeenCalledTimes(4); // initial + 3 retries
  }, 10000);

  it("retries transient 5xx and eventually succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, {}))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await piraeusRequest<{ ok: boolean }>({ accessToken: "t", path: "/v1/accounts" });
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up on persistent 5xx after the retry cap", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500, { message: "down" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(piraeusRequest({ accessToken: "t", path: "/v1/accounts" })).rejects.toBeInstanceOf(PiraeusApiError);
  }, 10000);

  it("wraps a malformed (non-JSON-parseable) error body without throwing a second, unrelated error", async () => {
    const badResponse = new Response("not json", { status: 400 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(badResponse));
    await expect(piraeusRequest({ accessToken: "t", path: "/v1/accounts" })).rejects.toBeInstanceOf(PiraeusApiError);
  });

  it("wraps a network-level fetch failure as PiraeusApiError after retries", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network down")));
    await expect(piraeusRequest({ accessToken: "t", path: "/v1/accounts" })).rejects.toBeInstanceOf(PiraeusApiError);
  }, 10000);
});
