import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { mapPiraeusNetworkError, PiraeusOAuthStateError, PiraeusTokenRefreshError } from "./errors";
import type { PiraeusTokenResponse } from "./types";

// docs/13-PIRAEUS-PROVIDER.md OAuth section. State is crypto-random,
// single-use, short-lived, and bound at issuance to the organization/
// user (and optionally company) that initiated the connect flow --
// the callback trusts only what's stored in OAuthState, never anything
// resubmitted by the browser (CLAUDE.md-style "never trust the client"
// applied to this flow specifically, per the task brief).

const STATE_TTL_MS = 10 * 60 * 1000;

function config() {
  const authorizeUrl = process.env.PIRAEUS_AUTHORIZE_URL;
  const tokenUrl = process.env.PIRAEUS_TOKEN_URL;
  const clientId = process.env.PIRAEUS_CLIENT_ID;
  const clientSecret = process.env.PIRAEUS_CLIENT_SECRET;
  const redirectUri = process.env.PIRAEUS_REDIRECT_URI;
  const scope = process.env.PIRAEUS_SCOPE;
  if (!authorizeUrl || !tokenUrl || !clientId || !clientSecret || !redirectUri || !scope) {
    throw new Error(
      "PIRAEUS_AUTHORIZE_URL, PIRAEUS_TOKEN_URL, PIRAEUS_CLIENT_ID, PIRAEUS_CLIENT_SECRET, PIRAEUS_REDIRECT_URI and PIRAEUS_SCOPE must all be set."
    );
  }
  return { authorizeUrl, tokenUrl, clientId, clientSecret, redirectUri, scope };
}

export async function createAuthorizationRequest(input: {
  organizationId: string;
  userId: string;
  companyId?: string;
}): Promise<{ url: string; state: string }> {
  const { authorizeUrl, clientId, redirectUri, scope } = config();
  const state = crypto.randomBytes(32).toString("base64url");

  await prisma.oAuthState.create({
    data: {
      id: state,
      organizationId: input.organizationId,
      userId: input.userId,
      companyId: input.companyId,
      providerType: "PIRAEUS_BANK",
      expiresAt: new Date(Date.now() + STATE_TTL_MS),
    },
  });

  // docs/13-PIRAEUS-PROVIDER.md "Assumptions": confirmed param names
  // (response_type/client_id/redirect_uri/scope) via search citations;
  // the exact authorize base URL/path is a TODO for 9A.2.
  const url = new URL(authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", scope);
  url.searchParams.set("state", state);
  return { url: url.toString(), state };
}

// Atomic: the update only succeeds if the row is still unconsumed and
// unexpired, so two concurrent callbacks for the same state can't both
// "win" -- one gets a 0-row update and throws.
export async function validateAndConsumeState(state: string) {
  const now = new Date();
  const result = await prisma.oAuthState.updateMany({
    where: { id: state, consumedAt: null, expiresAt: { gt: now } },
    data: { consumedAt: now },
  });
  if (result.count !== 1) {
    throw new PiraeusOAuthStateError("OAuth state is missing, expired, or already used.");
  }
  return prisma.oAuthState.findUniqueOrThrow({ where: { id: state } });
}

// Best-effort lookup for the invalid/expired/reused-state error path --
// audit needs an organizationId (AuditEvent.organizationId is a NOT
// NULL FK) but the state may already be gone or never have existed;
// callers must handle `undefined` by skipping that audit event rather
// than fabricating an organization id.
export async function findStateOrganizationId(state: string): Promise<string | undefined> {
  const row = await prisma.oAuthState.findUnique({ where: { id: state } });
  return row?.organizationId;
}

async function tokenRequest(body: Record<string, string>): Promise<PiraeusTokenResponse> {
  const { tokenUrl, clientId, clientSecret } = config();
  let response: Response;
  try {
    response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams(body),
    });
  } catch (err) {
    throw mapPiraeusNetworkError(err);
  }
  // Never log the response body here -- it's a token payload.
  if (!response.ok) {
    throw new PiraeusTokenRefreshError(`Piraeus token endpoint returned ${response.status}.`);
  }
  return (await response.json()) as PiraeusTokenResponse;
}

export async function exchangeAuthorizationCode(code: string): Promise<PiraeusTokenResponse> {
  const { redirectUri } = config();
  return tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
}

export async function refreshAccessToken(refreshToken: string): Promise<PiraeusTokenResponse> {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
}
