import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    providerConnection: { findUniqueOrThrow: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/providers/piraeus/oauth", () => ({ refreshAccessToken: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { refreshAccessToken } from "@/lib/providers/piraeus/oauth";
import { getValidAccessToken } from "@/lib/providers/piraeus/connection";
import { encryptPiraeusToken } from "@/lib/crypto/encryption";
import { PiraeusTokenRefreshError } from "@/lib/providers/piraeus/errors";

// Set synchronously at module load, before baseConnection below computes
// its encrypted fields -- beforeAll() runs too late for that.
process.env.PIRAEUS_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");

beforeEach(() => {
  vi.clearAllMocks();
});

const baseConnection = {
  id: "conn1",
  organizationId: "org1",
  version: 0,
  encryptedRefreshToken: encryptPiraeusToken("refresh-token-1"),
};

describe("getValidAccessToken", () => {
  it("returns the decrypted token directly when it's still fresh (no refresh call)", async () => {
    vi.mocked(prisma.providerConnection.findUniqueOrThrow).mockResolvedValueOnce({
      ...baseConnection,
      encryptedAccessToken: encryptPiraeusToken("fresh-token"),
      tokenExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
    } as never);

    const token = await getValidAccessToken("conn1");

    expect(token).toBe("fresh-token");
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it("refreshes when the token is expired and commits with an incremented version", async () => {
    vi.mocked(prisma.providerConnection.findUniqueOrThrow).mockResolvedValueOnce({
      ...baseConnection,
      encryptedAccessToken: encryptPiraeusToken("stale-token"),
      tokenExpiresAt: new Date(Date.now() - 1000),
    } as never);
    vi.mocked(refreshAccessToken).mockResolvedValueOnce({ access_token: "new-token", refresh_token: "new-refresh", token_type: "Bearer", expires_in: 3600 });
    vi.mocked(prisma.providerConnection.updateMany).mockResolvedValueOnce({ count: 1 });

    const token = await getValidAccessToken("conn1");

    expect(token).toBe("new-token");
    expect(prisma.providerConnection.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "conn1", version: 0 }, data: expect.objectContaining({ version: 1 }) })
    );
  });

  it("on a lost optimistic-lock race, discards its own refresh result and returns the winner's token", async () => {
    vi.mocked(prisma.providerConnection.findUniqueOrThrow)
      .mockResolvedValueOnce({
        ...baseConnection,
        encryptedAccessToken: encryptPiraeusToken("stale-token"),
        tokenExpiresAt: new Date(Date.now() - 1000),
      } as never)
      // Re-read after losing the race:
      .mockResolvedValueOnce({ encryptedAccessToken: encryptPiraeusToken("winners-token") } as never);
    vi.mocked(refreshAccessToken).mockResolvedValueOnce({ access_token: "losers-token", token_type: "Bearer", expires_in: 3600 });
    vi.mocked(prisma.providerConnection.updateMany).mockResolvedValueOnce({ count: 0 });

    const token = await getValidAccessToken("conn1");

    expect(token).toBe("winners-token");
  });

  it("throws without a refresh token on file", async () => {
    vi.mocked(prisma.providerConnection.findUniqueOrThrow).mockResolvedValueOnce({
      ...baseConnection,
      encryptedRefreshToken: null,
      encryptedAccessToken: encryptPiraeusToken("stale-token"),
      tokenExpiresAt: new Date(Date.now() - 1000),
    } as never);

    await expect(getValidAccessToken("conn1")).rejects.toBeInstanceOf(PiraeusTokenRefreshError);
  });

  it("marks the connection FAILED and rethrows when the refresh call itself fails", async () => {
    vi.mocked(prisma.providerConnection.findUniqueOrThrow).mockResolvedValueOnce({
      ...baseConnection,
      encryptedAccessToken: encryptPiraeusToken("stale-token"),
      tokenExpiresAt: new Date(Date.now() - 1000),
    } as never);
    vi.mocked(refreshAccessToken).mockRejectedValueOnce(new PiraeusTokenRefreshError("refresh endpoint down"));

    await expect(getValidAccessToken("conn1")).rejects.toBeInstanceOf(PiraeusTokenRefreshError);
    expect(prisma.providerConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) })
    );
  });
});
