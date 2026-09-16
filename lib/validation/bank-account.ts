import * as z from "zod";

// The exact asset set lib/ledger/money.ts's ASSET_PRECISION supports —
// rejecting an unsupported currency here (400) beats it throwing inside
// toMinorUnits() later.
const SUPPORTED_ASSETS = ["EUR", "USD", "RSD", "USDT", "USDC"] as const;

export const createBankAccountSchema = z.object({
  name: z.string().min(1).max(200),
  bankName: z.string().min(1).max(200),
  iban: z.string().max(50).optional(),
  accountNumberLast4: z.string().length(4).optional(),
  currency: z.enum(SUPPORTED_ASSETS),
});

// currency is intentionally not updatable — it's baked into the
// account's ledgerAccountAddress at creation (docs/00-ARCHITECTURE-FREEZE.md
// "do not mix assets"); changing it would orphan the ledger address.
export const updateBankAccountSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  bankName: z.string().min(1).max(200).optional(),
  iban: z.string().max(50).nullable().optional(),
  accountNumberLast4: z.string().length(4).nullable().optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "CLOSED"]).optional(),
});
