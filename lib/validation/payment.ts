import * as z from "zod";
import { decimalAmount } from "./money";

const PAYMENT_TYPE = [
  "INTERCOMPANY",
  "FREELANCER",
  "SUPPLIER",
  "TAX",
  "OPERATING_EXPENSE",
  "CRYPTO",
  "OTHER",
] as const;
const PAYMENT_METHOD = ["BANK_TRANSFER", "CRYPTO_EXCHANGE", "CARD_PAYOUT", "MANUAL"] as const;

export const createPaymentSchema = z.object({
  companyId: z.uuid(),
  bankAccountId: z.uuid(),
  beneficiaryId: z.uuid(),
  paymentType: z.enum(PAYMENT_TYPE),
  paymentMethod: z.enum(PAYMENT_METHOD),
  amount: decimalAmount,
  currency: z.string().length(3),
});

export const rejectPaymentSchema = z.object({
  reason: z.string().max(500).optional(),
});
