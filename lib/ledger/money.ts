// docs/02-LEDGER-SPEC.md: "If Formance asset precision notation is used,
// document it consistently per asset." This table is that documentation —
// the only place a decimal amount is converted to/from Formance's integer
// minor units, so architecture-freeze rule 3 (no floating point for money)
// holds at the one boundary where it matters.
const ASSET_PRECISION: Record<string, number> = {
  EUR: 2,
  USD: 2,
  RSD: 2,
  USDT: 6,
  USDC: 6,
};

export function assetPrecision(asset: string): number {
  const precision = ASSET_PRECISION[asset];
  if (precision === undefined) {
    throw new Error(`Unknown asset "${asset}" — add it to ASSET_PRECISION in lib/ledger/money.ts.`);
  }
  return precision;
}

// amount is a decimal string ("1250.50"), never a float, to avoid binary
// floating-point rounding before it ever reaches Formance.
export function toMinorUnits(amount: string, asset: string): bigint {
  if (!/^-?\d+(\.\d+)?$/.test(amount)) {
    throw new Error(`Invalid decimal amount "${amount}".`);
  }
  const precision = assetPrecision(asset);
  const negative = amount.startsWith("-");
  const unsigned = negative ? amount.slice(1) : amount;
  const [whole, fraction = ""] = unsigned.split(".");
  if (fraction.length > precision) {
    throw new Error(
      `Amount "${amount}" has more decimal places than ${asset} supports (${precision}).`
    );
  }
  const paddedFraction = fraction.padEnd(precision, "0");
  const minorUnits = BigInt(whole + paddedFraction);
  return negative ? -minorUnits : minorUnits;
}

export function fromMinorUnits(amount: bigint, asset: string): string {
  const precision = assetPrecision(asset);
  const negative = amount < 0n;
  const unsigned = (negative ? -amount : amount).toString().padStart(precision + 1, "0");
  const whole = unsigned.slice(0, unsigned.length - precision) || "0";
  const fraction = precision > 0 ? unsigned.slice(unsigned.length - precision) : "";
  const value = precision > 0 ? `${whole}.${fraction}` : whole;
  return negative ? `-${value}` : value;
}
