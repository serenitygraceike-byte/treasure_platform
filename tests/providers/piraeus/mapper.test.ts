import { describe, expect, it, beforeAll } from "vitest";
import { mapAccounts, mapBalances, mapTransactionDetail, mapTransactions } from "@/lib/providers/piraeus/mapper";

beforeAll(() => {
  process.env.PIRAEUS_FINGERPRINT_KEY = "test-fingerprint-key";
});

// Obviously synthetic fixture -- never a real production IBAN
// (CLAUDE.md rule 19 / docs/12-REAL-ENTITIES.md).
const SYNTHETIC_IBAN = "GR0000000000000000000000001";

describe("mapAccounts", () => {
  it("masks the IBAN and never returns it raw", () => {
    const [account] = mapAccounts({
      accounts: [{ resourceId: "res-1", iban: SYNTHETIC_IBAN, currency: "EUR", name: "Test" }],
    });
    expect(account!.maskedIdentifier).toBe("****0001");
    expect(account).not.toHaveProperty("iban");
    expect(JSON.stringify(account)).not.toContain(SYNTHETIC_IBAN);
  });

  it("falls back to the resourceId when no IBAN is present", () => {
    const [account] = mapAccounts({ accounts: [{ resourceId: "res-2", currency: "USD" }] });
    expect(account!.maskedIdentifier).toBe("****es-2");
  });
});

describe("mapBalances", () => {
  it("maps balance fields and picks a reference date", () => {
    const [balance] = mapBalances({
      balances: [{ balanceType: "closingBooked", balanceAmount: { amount: "1000.00", currency: "EUR" }, referenceDate: "2026-09-01" }],
    });
    expect(balance).toEqual({ balanceType: "closingBooked", amount: "1000.00", currency: "EUR", observedAt: "2026-09-01" });
  });
});

describe("mapTransactions / mapTransactionDetail", () => {
  it("uses the provider's stable transactionId as the fingerprint when present", () => {
    const [tx] = mapTransactions("ba1", {
      transactions: {
        booked: [
          {
            transactionId: "piraeus-tx-1",
            bookingDate: "2026-09-01",
            transactionAmount: { amount: "-50.00", currency: "EUR" },
            creditorName: "Acme Supplier",
            creditorAccount: { iban: "GR0000000000000000000000002" },
            remittanceInformationUnstructured: "Invoice 42",
          },
        ],
      },
    });
    expect(tx!.externalTransactionId).toBe("piraeus-tx-1");
    expect(tx!.fingerprint).toBe("piraeus-tx-1");
    expect(tx!.creditDebitIndicator).toBe("DEBIT");
    expect(tx!.counterpartyName).toBe("Acme Supplier");
    expect(tx!.counterpartyIban).toBe("GR0000000000000000000000002");
  });

  it("falls back to a keyed fingerprint when no stable id is supplied", () => {
    const raw = {
      bookingDate: "2026-09-02",
      transactionAmount: { amount: "100.00", currency: "EUR" },
      debtorName: "Client Co",
    };
    const [tx] = mapTransactions("ba1", { transactions: { booked: [raw] } });
    expect(tx!.externalTransactionId).toBeUndefined();
    expect(tx!.fingerprint).toHaveLength(64); // hex sha256
    expect(tx!.creditDebitIndicator).toBe("CREDIT");

    // Same input, same bank account -> same fallback fingerprint (dedup
    // safety across repeated syncs of the same range).
    const [tx2] = mapTransactions("ba1", { transactions: { booked: [{ ...raw }] } });
    expect(tx2!.fingerprint).toBe(tx!.fingerprint);

    // A different bank account must not collide.
    const [tx3] = mapTransactions("ba2", { transactions: { booked: [{ ...raw }] } });
    expect(tx3!.fingerprint).not.toBe(tx!.fingerprint);
  });

  it("mapTransactionDetail reuses the same mapping logic", () => {
    const detail = mapTransactionDetail("ba1", {
      transactionId: "piraeus-tx-9",
      bookingDate: "2026-09-03",
      transactionAmount: { amount: "10.00", currency: "EUR" },
    });
    expect(detail.externalTransactionId).toBe("piraeus-tx-9");
  });
});
