import { describe, expect, it } from "vitest";
import {
  bankAddress,
  counterpartyAddress,
  expenseAddress,
  inTransitAddress,
  payableAddress,
  reservedAddress,
  sanitizeSegment,
} from "@/lib/ledger/accounts";

describe("sanitizeSegment", () => {
  it("strips hyphens from a UUID so the address matches Formance's ^\\w+(:\\w+)*$", () => {
    const uuid = "11111111-1111-4111-8111-000000000001";
    const sanitized = sanitizeSegment(uuid);
    expect(sanitized).toBe(uuid.replace(/-/g, ""));
    expect(sanitized).toMatch(/^\w+$/);
  });

  it("throws when a segment has no valid characters left", () => {
    expect(() => sanitizeSegment("---")).toThrow(/no valid address characters/);
  });
});

describe("deterministic address builders", () => {
  const org = "11111111-1111-4111-8111-000000000001";
  const company = "22222222-2222-4222-8222-000000000002";

  it("builds a bank address", () => {
    const bank = "33333333-3333-4333-8333-000000000003";
    const address = bankAddress(org, company, bank, "EUR");
    expect(address).toMatch(/^\w+(:\w+)*$/);
    expect(address).toBe(
      `org:${sanitizeSegment(org)}:company:${sanitizeSegment(company)}:bank:${sanitizeSegment(bank)}:EUR`
    );
  });

  it("builds distinct reserved and in_transit addresses for the same company", () => {
    const reserved = reservedAddress(org, company, "EUR");
    const inTransit = inTransitAddress(org, company, "EUR");
    expect(reserved).not.toBe(inTransit);
    expect(reserved).toMatch(/^\w+(:\w+)*$/);
    expect(inTransit).toMatch(/^\w+(:\w+)*$/);
  });

  it("builds an expense address scoped by category", () => {
    const hosting = expenseAddress(org, company, "hosting", "EUR");
    const payroll = expenseAddress(org, company, "payroll", "EUR");
    expect(hosting).not.toBe(payroll);
  });

  it("builds a payable address", () => {
    expect(payableAddress(org, company, "EUR")).toMatch(/^\w+(:\w+)*$/);
  });

  it("builds a counterparty address", () => {
    const counterparty = "44444444-4444-4444-8444-000000000004";
    const address = counterpartyAddress(org, counterparty, "EUR");
    expect(address).toBe(`org:${sanitizeSegment(org)}:counterparty:${sanitizeSegment(counterparty)}:EUR`);
  });
});
