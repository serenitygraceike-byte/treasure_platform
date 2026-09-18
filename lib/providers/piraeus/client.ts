import { mapPiraeusHttpError, mapPiraeusNetworkError, PiraeusApiError, PiraeusRateLimitError } from "./errors";

// Thin, isolated HTTP client -- docs/02-LEDGER-SPEC.md's "Ledger
// adapter" pattern applied here: the rest of the app never calls fetch
// against Piraeus directly, only through this file (and oauth.ts for
// the token endpoints). No response body, header, or token is ever
// logged -- only method + path + status + duration, matching
// docs/13-PIRAEUS-PROVIDER.md's security controls. 401 is surfaced as
// PiraeusAuthError and left for the caller to handle (token refresh
// lives in lib/providers/piraeus/oauth.ts + provider.ts, not here --
// this client has no refresh-token context).

function config() {
  const baseUrl = process.env.PIRAEUS_BASE_URL;
  if (!baseUrl) {
    throw new Error("PIRAEUS_BASE_URL must be set.");
  }
  return { baseUrl: baseUrl.replace(/\/+$/, "") };
}

const REQUEST_TIMEOUT_MS = 15_000;
// TODO(9A.2): no published Piraeus rate limit was found (docs/13-
// PIRAEUS-PROVIDER.md "Assumptions") -- this cap and the backoff below
// are conservative defaults, not confirmed numbers.
const MAX_TRANSIENT_RETRIES = 3;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOnce(url: URL, method: "GET" | "POST", accessToken: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function piraeusRequest<T>(input: {
  accessToken: string;
  path: string;
  query?: Record<string, string | undefined>;
  method?: "GET" | "POST";
}): Promise<T> {
  const { baseUrl } = config();
  const url = new URL(baseUrl + input.path);
  for (const [k, v] of Object.entries(input.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, v);
  }
  const method = input.method ?? "GET";

  for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await fetchOnce(url, method, input.accessToken);
    } catch (err) {
      if (attempt < MAX_TRANSIENT_RETRIES) {
        await sleep(2 ** attempt * 500);
        continue;
      }
      throw mapPiraeusNetworkError(err);
    }

    const durationMs = Date.now() - startedAt;
    // Structured, secret-free log line: method/path/status/duration only.
    console.log(JSON.stringify({ scope: "piraeus_client", method, path: input.path, status: response.status, durationMs }));

    if (response.status === 429) {
      if (attempt < MAX_TRANSIENT_RETRIES) {
        const retryAfter = Number(response.headers.get("retry-after"));
        await sleep((Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 2 ** attempt) * 1000);
        continue;
      }
      throw new PiraeusRateLimitError("Piraeus rate-limited this request after retries.");
    }

    if (response.status >= 500) {
      if (attempt < MAX_TRANSIENT_RETRIES) {
        await sleep(2 ** attempt * 500);
        continue;
      }
      const body = await response.json().catch(() => undefined);
      throw mapPiraeusHttpError(response.status, body);
    }

    if (!response.ok) {
      const body = await response.json().catch(() => undefined);
      throw mapPiraeusHttpError(response.status, body);
    }

    return (await response.json()) as T;
  }

  // Unreachable -- the loop above always returns or throws -- but keeps
  // the function's return type honest for TypeScript.
  throw new PiraeusApiError("PIRAEUS_UNREACHABLE", "Exhausted retries without a definitive result.");
}
