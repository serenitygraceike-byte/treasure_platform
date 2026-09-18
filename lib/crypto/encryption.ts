import crypto from "node:crypto";

// Shared AES-256-GCM primitives (encryptWithKey/decryptWithKey below),
// each caller using its own env-var key so rotating one secret never
// affects another:
// - payout details (Phase 6, docs/01-DATABASE-SPEC.md's
//   payout_details_encrypted column) -- PAYOUT_ENCRYPTION_KEY
// - Piraeus OAuth tokens (Phase 9A, docs/13-PIRAEUS-PROVIDER.md) --
//   PIRAEUS_TOKEN_ENCRYPTION_KEY
// Never log or return any plaintext once encrypted --
// docs/07-SECURITY-AND-AUDIT.md "Never store passwords or raw secrets
// in audit logs" applies here too.

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function keyFromEnv(envVar: string): Buffer {
  const raw = process.env[envVar];
  if (!raw) {
    throw new Error(`${envVar} must be set.`);
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error(`${envVar} must decode to exactly 32 bytes (base64-encoded).`);
  }
  return buf;
}

// Output layout: base64(iv[12] || authTag[16] || ciphertext) -- one
// opaque string, safe to store directly in a DB column.
function encryptWithKey(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

function decryptWithKey(encoded: string, key: Buffer): string {
  const raw = Buffer.from(encoded, "base64");
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = raw.subarray(IV_LENGTH + 16);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function encryptPayoutDetails(plaintext: string): string {
  return encryptWithKey(plaintext, keyFromEnv("PAYOUT_ENCRYPTION_KEY"));
}

export function decryptPayoutDetails(encoded: string): string {
  return decryptWithKey(encoded, keyFromEnv("PAYOUT_ENCRYPTION_KEY"));
}

// Phase 9A -- Piraeus OAuth access/refresh tokens. A separate key from
// payout details (PIRAEUS_TOKEN_ENCRYPTION_KEY, see .env.example) so
// rotating one never affects the other.
export function encryptPiraeusToken(plaintext: string): string {
  return encryptWithKey(plaintext, keyFromEnv("PIRAEUS_TOKEN_ENCRYPTION_KEY"));
}

export function decryptPiraeusToken(encoded: string): string {
  return decryptWithKey(encoded, keyFromEnv("PIRAEUS_TOKEN_ENCRYPTION_KEY"));
}

// Phase 9A -- deterministic account matching without comparing/logging
// raw IBANs (docs/13-PIRAEUS-PROVIDER.md). Keyed HMAC, not a plain hash,
// per CLAUDE.md: an unkeyed hash of an IBAN is brute-forceable (IBANs
// have far less entropy than a real secret) and a keyed HMAC prevents
// mounting a rainbow-table attack against a leaked column.
function fingerprintKey(): string {
  const raw = process.env.PIRAEUS_FINGERPRINT_KEY;
  if (!raw) {
    throw new Error("PIRAEUS_FINGERPRINT_KEY must be set.");
  }
  return raw;
}

export function fingerprintAccountIdentifier(identifier: string): string {
  return crypto.createHmac("sha256", fingerprintKey()).update(identifier.trim().toUpperCase()).digest("hex");
}

// Fallback dedup key for an imported transaction that has no provider-
// supplied stable id (lib/providers/piraeus/mapper.ts) -- a keyed HMAC
// over the fields that together make a transaction unique enough in
// practice (booking date, amount, currency, counterparty reference),
// same "keyed, not a plain hash" reasoning as the account fingerprint.
export function fingerprintTransactionFallback(parts: string[]): string {
  return crypto.createHmac("sha256", fingerprintKey()).update(parts.join("|")).digest("hex");
}

// Never log/return a full identifier -- only this, everywhere Phase 9A
// needs to reference "which account" in an error, audit event, or UI.
export function maskAccountIdentifier(identifier: string): string {
  const trimmed = identifier.trim();
  if (trimmed.length <= 4) return "****";
  return `****${trimmed.slice(-4)}`;
}
