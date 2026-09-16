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
