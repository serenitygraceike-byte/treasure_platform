import { describe, expect, it, vi, beforeEach, beforeAll } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    oAuthState: { create: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn(), findUnique: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  createAuthorizationRequest,
  exchangeAuthorizationCode,
  findStateOrganizationId,
  refreshAccessToken,
  validateAndConsumeState,
} from "@/lib/providers/piraeus/oauth";
import { PiraeusOAuthStateError, PiraeusTokenRefreshError } from "@/lib/providers/piraeus/errors";

beforeAll(() => {
  process.env.PIRAEUS_AUTHORIZE_URL = "https://rapidlink.example/oauth2/authorize";
  process.env.PIRAEUS_TOKEN_URL = "https://api.rapidlink.example/oauth2/token";
  process.env.PIRAEUS_CLIENT_ID = "test-client-id";
  process.env.PIRAEUS_CLIENT_SECRET = "test-client-secret";
  process.env.PIRAEUS_REDIRECT_URI = "http://localhost:3000/api/v1/providers/piraeus/callback";
  process.env.PIRAEUS_SCOPE = "winbankAccess.info";
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("createAuthorizationRequest", () => {
  it("builds the authorization URL with the confirmed OAuth param names and persists a state row", async () => {
    vi.mocked(prisma.oAuthState.create).mockResolvedValueOnce({} as never);

    const { url, state } = await createAuthorizationRequest({ organizationId: "org1", userId: "u1" });

    const parsed = new URL(url);
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("client_id")).toBe("test-client-id");
    expect(parsed.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/v1/providers/piraeus/callback");
    expect(parsed.searchParams.get("scope")).toBe("winbankAccess.info");
    expect(parsed.searchParams.get("state")).toBe(state);
    expect(state.length).toBeGreaterThanOrEqual(32);

    expect(prisma.oAuthState.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ organizationId: "org1", userId: "u1", providerType: "PIRAEUS_BANK" }) })
    );
  });
});

describe("validateAndConsumeState", () => {
  it("rejects a state that doesn't exist, has expired, or was already consumed (count !== 1)", async () => {
    vi.mocked(prisma.oAuthState.updateMany).mockResolvedValueOnce({ count: 0 });
    await expect(validateAndConsumeState("bad-state")).rejects.toBeInstanceOf(PiraeusOAuthStateError);
  });

  it("accepts and returns the row when exactly one row was atomically consumed", async () => {
    vi.mocked(prisma.oAuthState.updateMany).mockResolvedValueOnce({ count: 1 });
    vi.mocked(prisma.oAuthState.findUniqueOrThrow).mockResolvedValueOnce({ id: "s1", organizationId: "org1" } as never);

    const row = await validateAndConsumeState("s1");
    expect(row).toEqual({ id: "s1", organizationId: "org1" });
  });

  it("a second concurrent call for the same state is rejected (single-use)", async () => {
    vi.mocked(prisma.oAuthState.updateMany).mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    vi.mocked(prisma.oAuthState.findUniqueOrThrow).mockResolvedValueOnce({ id: "s1" } as never);

    await validateAndConsumeState("s1");
    await expect(validateAndConsumeState("s1")).rejects.toBeInstanceOf(PiraeusOAuthStateError);
  });
});

describe("findStateOrganizationId", () => {
  it("returns undefined when the state row is gone entirely", async () => {
    vi.mocked(prisma.oAuthState.findUnique).mockResolvedValueOnce(null);
    expect(await findStateOrganizationId("missing")).toBeUndefined();
  });

  it("returns the organizationId when the row still exists (even if expired/consumed)", async () => {
    vi.mocked(prisma.oAuthState.findUnique).mockResolvedValueOnce({ organizationId: "org1" } as never);
    expect(await findStateOrganizationId("s1")).toBe("org1");
  });
});

describe("token endpoints", () => {
  it("exchangeAuthorizationCode posts grant_type=authorization_code and never logs the response", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "at", refresh_token: "rt", token_type: "Bearer", expires_in: 3600 }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await exchangeAuthorizationCode("auth-code-1");

    expect(result.access_token).toBe("at");
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init.body as URLSearchParams).get("grant_type")).toBe("authorization_code");
    expect((init.body as URLSearchParams).get("code")).toBe("auth-code-1");
  });

  it("refreshAccessToken posts grant_type=refresh_token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "at2", token_type: "Bearer", expires_in: 3600 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await refreshAccessToken("old-refresh-token");

    expect(result.access_token).toBe("at2");
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init.body as URLSearchParams).get("grant_type")).toBe("refresh_token");
    expect((init.body as URLSearchParams).get("refresh_token")).toBe("old-refresh-token");
  });

  it("throws PiraeusTokenRefreshError on a non-2xx token response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("{}", { status: 400 })));
    await expect(refreshAccessToken("bad-token")).rejects.toBeInstanceOf(PiraeusTokenRefreshError);
  });
});
