import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { decryptPiraeusToken, encryptPiraeusToken } from "@/lib/crypto/encryption";
import { refreshAccessToken } from "./oauth";
import { PiraeusTokenRefreshError } from "./errors";

// docs/13-PIRAEUS-PROVIDER.md "Concurrent refresh operations must not
// corrupt stored credentials": ProviderConnection.version is bumped on
// every token write; a refresh only commits if the row still has the
// version it read, so two concurrent refreshes can't stomp on each
// other -- the loser just re-reads the winner's fresh token instead of
// overwriting it with its own (now-superseded) refresh result.
const EXPIRY_SKEW_MS = 60_000;

export async function getValidAccessToken(connectionId: string): Promise<string> {
  const connection = await prisma.providerConnection.findUniqueOrThrow({ where: { id: connectionId } });
  if (!connection.encryptedAccessToken) {
    throw new PiraeusTokenRefreshError("This connection has no access token yet.");
  }

  const stillFresh = connection.tokenExpiresAt && connection.tokenExpiresAt.getTime() - EXPIRY_SKEW_MS > Date.now();
  if (stillFresh) {
    return decryptPiraeusToken(connection.encryptedAccessToken);
  }

  if (!connection.encryptedRefreshToken) {
    throw new PiraeusTokenRefreshError("Access token expired and no refresh token is on file.");
  }

  try {
    const refreshed = await refreshAccessToken(decryptPiraeusToken(connection.encryptedRefreshToken));
    const updateResult = await prisma.providerConnection.updateMany({
      where: { id: connectionId, version: connection.version },
      data: {
        encryptedAccessToken: encryptPiraeusToken(refreshed.access_token),
        encryptedRefreshToken: refreshed.refresh_token
          ? encryptPiraeusToken(refreshed.refresh_token)
          : connection.encryptedRefreshToken,
        tokenExpiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
        version: connection.version + 1,
        lastError: null,
      },
    });

    if (updateResult.count === 0) {
      // Someone else refreshed first -- use their result, discard ours.
      const winner = await prisma.providerConnection.findUniqueOrThrow({ where: { id: connectionId } });
      return decryptPiraeusToken(winner.encryptedAccessToken!);
    }

    await logAudit({
      organizationId: connection.organizationId,
      action: "provider_connection.token_refresh",
      objectType: "provider_connection",
      objectId: connectionId,
    });

    return refreshed.access_token;
  } catch (err) {
    await prisma.providerConnection.update({
      where: { id: connectionId },
      data: { lastError: err instanceof Error ? err.message : "Token refresh failed.", status: "FAILED" },
    });
    await logAudit({
      organizationId: connection.organizationId,
      action: "provider_connection.token_refresh_failed",
      objectType: "provider_connection",
      objectId: connectionId,
    });
    throw err;
  }
}
