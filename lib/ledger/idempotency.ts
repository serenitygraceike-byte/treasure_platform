import { LedgerError } from "./errors";

// Formance's own Idempotency-Key handling on POST /v2/{ledger}/transactions
// is the source of truth for "repeat the same key safely" (architecture
// freeze rule 7) — this just enforces that every money-moving call
// actually supplies one, instead of duplicating a store in the app DB.
export function requireIdempotencyKey(key: string | undefined | null): string {
  if (!key || key.trim().length === 0) {
    throw new LedgerError(
      "IDEMPOTENCY_KEY_REQUIRED",
      "An idempotency key is required for this ledger operation."
    );
  }
  return key;
}

export function requireCorrelationId(id: string | undefined | null): string {
  if (!id || id.trim().length === 0) {
    throw new LedgerError(
      "CORRELATION_ID_REQUIRED",
      "A correlation id is required for this ledger operation."
    );
  }
  return id;
}
