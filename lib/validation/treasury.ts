import * as z from "zod";

// Money amounts are decimal strings end-to-end (never a JSON number/float)
// -- lib/ledger/money.ts's toMinorUnits() is the only place a decimal
// converts to Formance's integer minor units, and it needs a string input
// to avoid floating-point rounding before that boundary.
const decimalAmount = z
  .string()
  .regex(/^\d+(\.\d{1,8})?$/, "amount must be a positive decimal string with up to 8 decimal places")
  .refine((v) => !/^0(\.0+)?$/.test(v), "amount must be greater than zero");

export const createReservationSchema = z.object({
  amount: decimalAmount,
});

export const createTransferSchema = z.object({
  destinationAccountId: z.uuid(),
  amount: decimalAmount,
});
