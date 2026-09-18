export type Posting = {
  source: string;
  destination: string;
  amount: bigint;
  asset: string;
};

// The four named patterns from docs/02-LEDGER-SPEC.md "Core posting
// patterns". Each returns a single balanced posting — Formance balances a
// transaction per-posting (source -amount, destination +amount), so unlike
// the doc's two-line illustration there is only one posting object to
// build per pattern, not two.

export function reserveFundsPosting(bankAddress: string, reservedAddress: string, amount: bigint, asset: string): Posting {
  return { source: bankAddress, destination: reservedAddress, amount, asset };
}

export function releaseReservationPosting(reservedAddress: string, bankAddress: string, amount: bigint, asset: string): Posting {
  return { source: reservedAddress, destination: bankAddress, amount, asset };
}

export function startTransferPosting(bankAddress: string, inTransitAddress: string, amount: bigint, asset: string): Posting {
  return { source: bankAddress, destination: inTransitAddress, amount, asset };
}

export function settleTransferPosting(inTransitAddress: string, destinationAddress: string, amount: bigint, asset: string): Posting {
  return { source: inTransitAddress, destination: destinationAddress, amount, asset };
}

// Not one of the four docs/02-LEDGER-SPEC.md patterns by name, but the
// exact reverse of startTransferPosting -- the compensation path
// docs/02-LEDGER-SPEC.md "Financial invariants" requires for a failed
// external payment (lib/payments/payments.ts handlePaymentFailed).
export function reverseTransferPosting(inTransitAddress: string, bankAddress: string, amount: bigint, asset: string): Posting {
  return { source: inTransitAddress, destination: bankAddress, amount, asset };
}
