import crypto from "node:crypto";

// docs/01-DATABASE-SPEC.md names the column payout_details_encrypted --
// AES-256-GCM at the application layer, key from PAYOUT_ENCRYPTION_KEY
// (see .env.example). Never log or return the plaintext once encrypted;
// docs/07-SECURITY-AND-AUDIT.md "Never store passwords or raw secrets in
// audit logs" applies to payout details the same way.

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function key(): Buffer {
  const raw = process.env.PAYOUT_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("PAYOUT_ENCRYPTION_KEY must be set.");
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error("PAYOUT_ENCRYPTION_KEY must decode to exactly 32 bytes (base64-encoded).");
  }
  return buf;
}

// Output layout: base64(iv[12] || authTag[16] || ciphertext) -- one
// opaque string, safe to store directly in payoutDetailsEncrypted.
export function encryptPayoutDetails(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decryptPayoutDetails(encoded: string): string {
  const raw = Buffer.from(encoded, "base64");
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = raw.subarray(IV_LENGTH + 16);
  const decipher = crypto.createDecipheriv(ALGORITHM, key(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
