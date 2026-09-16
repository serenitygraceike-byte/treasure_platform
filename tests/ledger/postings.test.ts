import { describe, expect, it } from "vitest";
import {
  releaseReservationPosting,
  reserveFundsPosting,
  settleTransferPosting,
  startTransferPosting,
} from "@/lib/ledger/postings";

const BANK = "org:1:company:1:bank:1:EUR";
const RESERVED = "org:1:company:1:reserved:EUR";
const IN_TRANSIT = "org:1:company:1:in_transit:EUR";
const DESTINATION = "org:2:company:2:bank:2:EUR";
const AMOUNT = 10000n;

describe("posting pattern builders (docs/02-LEDGER-SPEC.md)", () => {
  it("A. reserve funds: bank -> reserved", () => {
    expect(reserveFundsPosting(BANK, RESERVED, AMOUNT, "EUR")).toEqual({
      source: BANK,
      destination: RESERVED,
      amount: AMOUNT,
      asset: "EUR",
    });
  });

  it("B. release reservation: reserved -> bank", () => {
    expect(releaseReservationPosting(RESERVED, BANK, AMOUNT, "EUR")).toEqual({
      source: RESERVED,
      destination: BANK,
      amount: AMOUNT,
      asset: "EUR",
    });
  });

  it("C. start transfer: bank -> in_transit", () => {
    expect(startTransferPosting(BANK, IN_TRANSIT, AMOUNT, "EUR")).toEqual({
      source: BANK,
      destination: IN_TRANSIT,
      amount: AMOUNT,
      asset: "EUR",
    });
  });

  it("D. settle transfer: in_transit -> destination", () => {
    expect(settleTransferPosting(IN_TRANSIT, DESTINATION, AMOUNT, "EUR")).toEqual({
      source: IN_TRANSIT,
      destination: DESTINATION,
      amount: AMOUNT,
      asset: "EUR",
    });
  });

  it("release is the exact inverse of reserve", () => {
    const reserve = reserveFundsPosting(BANK, RESERVED, AMOUNT, "EUR");
    const release = releaseReservationPosting(RESERVED, BANK, AMOUNT, "EUR");
    expect(release.source).toBe(reserve.destination);
    expect(release.destination).toBe(reserve.source);
  });
});
