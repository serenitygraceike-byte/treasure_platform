// docs/07-SECURITY-AND-AUDIT.md: never expose raw provider error bodies
// upward. Same shape/role as lib/ledger/errors.ts's LedgerError -- every
// caller outside this directory gets a stable code/message, never a raw
// Piraeus response body, header, or thrown fetch exception.
export class PiraeusApiError extends Error {
  readonly code: string;
  readonly httpStatus?: number;
  readonly cause?: unknown;

  constructor(code: string, message: string, httpStatus?: number, cause?: unknown) {
    super(message);
    this.name = "PiraeusApiError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.cause = cause;
  }
}

// 401 from Piraeus -- lib/providers/piraeus/client.ts triggers a token
// refresh attempt on this specifically, per the task's explicit "401/
// token refresh behavior" requirement.
export class PiraeusAuthError extends PiraeusApiError {
  constructor(message: string, cause?: unknown) {
    super("PIRAEUS_AUTH_ERROR", message, 401, cause);
    this.name = "PiraeusAuthError";
  }
}

// 429 -- lib/providers/piraeus/client.ts backs off and retries a
// bounded number of times before surfacing this.
export class PiraeusRateLimitError extends PiraeusApiError {
  readonly retryAfterSeconds?: number;
  constructor(message: string, retryAfterSeconds?: number) {
    super("PIRAEUS_RATE_LIMITED", message, 429);
    this.name = "PiraeusRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class PiraeusOAuthStateError extends Error {}
export class PiraeusTokenRefreshError extends PiraeusApiError {
  constructor(message: string, cause?: unknown) {
    super("PIRAEUS_TOKEN_REFRESH_FAILED", message, undefined, cause);
    this.name = "PiraeusTokenRefreshError";
  }
}

export function mapPiraeusHttpError(status: number, body: unknown): PiraeusApiError {
  if (status === 401) return new PiraeusAuthError("Piraeus rejected the access token.", body);
  if (status === 429) return new PiraeusRateLimitError("Piraeus rate-limited this request.");
  const parsed = (body ?? {}) as { tppMessages?: Array<{ code?: string; text?: string }>; message?: string };
  const first = parsed.tppMessages?.[0];
  const code = first?.code ?? `HTTP_${status}`;
  const message = first?.text ?? parsed.message ?? `Piraeus request failed with status ${status}.`;
  return new PiraeusApiError(code, message, status, body);
}

export function mapPiraeusNetworkError(cause: unknown): PiraeusApiError {
  return new PiraeusApiError("PIRAEUS_UNAVAILABLE", "Could not reach Piraeus rAPId Link.", undefined, cause);
}
