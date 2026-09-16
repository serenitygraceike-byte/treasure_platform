import { describe, expect, it } from "vitest";
import { fromMinorUnits, toMinorUnits } from "@/lib/ledger/money";

describe("toMinorUnits / fromMinorUnits", () => {
  it("converts a 2-decimal asset (EUR) to minor units", () => {
    expect(toMinorUnits("1250.50", "EUR")).toBe(125050n);
    expect(fromMinorUnits(125050n, "EUR")).toBe("1250.50");
  });

  it("converts a 6-decimal asset (USDT) to minor units", () => {
    expect(toMinorUnits("1.5", "USDT")).toBe(1500000n);
    expect(fromMinorUnits(1500000n, "USDT")).toBe("1.500000");
  });

  it("round-trips a whole-number amount", () => {
    expect(toMinorUnits("100", "USD")).toBe(10000n);
    expect(fromMinorUnits(10000n, "USD")).toBe("100.00");
  });

  it("rejects an amount with more decimal places than the asset supports", () => {
    expect(() => toMinorUnits("1.005", "EUR")).toThrow(/decimal places/);
  });

  it("rejects a non-decimal string", () => {
    expect(() => toMinorUnits("abc", "EUR")).toThrow(/Invalid decimal amount/);
  });

  it("rejects an unknown asset", () => {
    expect(() => toMinorUnits("10", "XYZ")).toThrow(/Unknown asset/);
  });

  it("handles negative amounts", () => {
    expect(toMinorUnits("-10.00", "EUR")).toBe(-1000n);
    expect(fromMinorUnits(-1000n, "EUR")).toBe("-10.00");
  });
});
