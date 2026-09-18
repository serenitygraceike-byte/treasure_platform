import * as z from "zod";

const COUNTERPARTY_TYPE = ["COMPANY", "INDIVIDUAL"] as const;
const PAYMENT_METHOD = ["BANK_TRANSFER", "CRYPTO_EXCHANGE", "CARD_PAYOUT", "MANUAL"] as const;

export const createCounterpartySchema = z.object({
  legalName: z.string().min(1).max(200),
  type: z.enum(COUNTERPARTY_TYPE),
  countryCode: z.string().length(2).optional(),
  registrationNumber: z.string().max(100).optional(),
  taxIdentifier: z.string().max(100).optional(),
  externalReference: z.string().max(200).optional(),
});

export const createBeneficiarySchema = z.object({
  paymentMethod: z.enum(PAYMENT_METHOD),
  payoutDetails: z.string().min(1).max(2000),
});
