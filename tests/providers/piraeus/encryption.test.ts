import { describe, expect, it, beforeAll } from "vitest";
import {
  decryptPiraeusToken,
  encryptPiraeusToken,
  fingerprintAccountIdentifier,
  fingerprintTransactionFallback,
  maskAccountIdentifier,
} from "@/lib/crypto/encryption";

beforeAll(() => {
  process.env.PIRAEUS_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");
  process.env.PIRAEUS_FINGERPRINT_KEY = "test-fingerprint-key";
});

describe("Piraeus token encryption", () => {
  it("round-trips a token", () => {
    const encrypted = encryptPiraeusToken("access-token-value");
    expect(encrypted).not.toContain("access-token-value");
    expect(decryptPiraeusToken(encrypted)).toBe("access-token-value");
  });

  it("uses a different key namespace than payout details", async () => {
    process.env.PAYOUT_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    const { encryptPayoutDetails } = await import("@/lib/crypto/encryption");
    const payoutCipher = encryptPayoutDetails("GR1601101250000000012300695");
    // Decrypting a payout-details ciphertext with the token key must fail
    // (different key, different keyspace) -- proves the two are isolated.
    expect(() => decryptPiraeusToken(payoutCipher)).toThrow();
  });
});

// Obviously synthetic fixtures -- never a real production IBAN
// (CLAUDE.md rule 19 / docs/12-REAL-ENTITIES.md).
const SYNTHETIC_IBAN_1 = "GR0000000000000000000000001";
const SYNTHETIC_IBAN_2 = "GR0000000000000000000000002";

describe("fingerprintAccountIdentifier", () => {
  it("is deterministic for the same IBAN", () => {
    const a = fingerprintAccountIdentifier(SYNTHETIC_IBAN_1);
    const b = fingerprintAccountIdentifier(SYNTHETIC_IBAN_1);
    expect(a).toBe(b);
  });

  it("normalizes case and surrounding whitespace", () => {
    const a = fingerprintAccountIdentifier(SYNTHETIC_IBAN_1.toLowerCase());
    const b = fingerprintAccountIdentifier(`  ${SYNTHETIC_IBAN_1}  `);
    expect(a).toBe(b);
  });

  it("differs for different IBANs", () => {
    const a = fingerprintAccountIdentifier(SYNTHETIC_IBAN_1);
    const b = fingerprintAccountIdentifier(SYNTHETIC_IBAN_2);
    expect(a).not.toBe(b);
  });

  it("never contains the raw IBAN as a substring", () => {
    expect(fingerprintAccountIdentifier(SYNTHETIC_IBAN_1)).not.toContain(SYNTHETIC_IBAN_1);
  });
});

describe("fingerprintTransactionFallback", () => {
  it("is deterministic for the same parts and differs when a part changes", () => {
    const parts = ["ba1", "2026-01-01", "10.00", "EUR", "invoice 42"];
    expect(fingerprintTransactionFallback(parts)).toBe(fingerprintTransactionFallback([...parts]));
    expect(fingerprintTransactionFallback(parts)).not.toBe(
      fingerprintTransactionFallback(["ba1", "2026-01-02", "10.00", "EUR", "invoice 42"])
    );
  });
});

describe("maskAccountIdentifier", () => {
  it("keeps only the last 4 characters", () => {
    expect(maskAccountIdentifier(SYNTHETIC_IBAN_1)).toBe("****0001");
  });

  it("fully masks a short identifier", () => {
    expect(maskAccountIdentifier("ab")).toBe("****");
  });
});
