// docs/07-SECURITY-AND-AUDIT.md: never expose raw provider error bodies
// upward. LedgerError is the only shape lib/ledger/ throws — callers get a
// stable code/message, never Formance's raw response or a fetch exception.
export class LedgerError extends Error {
  readonly code: string;
  readonly cause?: unknown;

  constructor(code: string, message: string, cause?: unknown) {
    super(message);
    this.name = "LedgerError";
    this.code = code;
    this.cause = cause;
  }
}

type FormanceErrorBody = {
  errorCode?: string;
  errorMessage?: string;
};

export function mapFormanceError(status: number, body: unknown): LedgerError {
  const parsed = (body ?? {}) as FormanceErrorBody;
  const code = parsed.errorCode ?? `HTTP_${status}`;
  const message = parsed.errorMessage ?? `Formance request failed with status ${status}.`;
  return new LedgerError(code, message, body);
}

export function mapNetworkError(cause: unknown): LedgerError {
  return new LedgerError("LEDGER_UNAVAILABLE", "Could not reach the ledger service.", cause);
}
